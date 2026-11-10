import type {
  PdfFacts,
  PdfFigure,
  PdfInfo,
  PdfjsLike,
  PdfjsMetadata,
  PdfjsStructNode,
  PdfPage,
  PdfXmp,
} from './types.js';

const PT_TO_MM = 25.4 / 72;

/** Reads a key from a pdf.js result that may be a `Map` or a plain object. */
function pick(source: unknown, key: string): unknown {
  if (source instanceof Map) return source.get(key);
  if (source && typeof source === 'object') return (source as Record<string, unknown>)[key];
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** pdf.js concatenates rdf:Alt entries; collapse an exact repetition ("TT" → "T"). */
function dedupeRepeat(s: string | undefined): string | undefined {
  if (!s) return s;
  for (let parts = 2; parts <= 4; parts++) {
    if (s.length % parts !== 0) continue;
    const unit = s.slice(0, s.length / parts);
    if (unit.repeat(parts) === s) return unit;
  }
  return s;
}

function readInfo(info: object): PdfInfo {
  const out: PdfInfo = {};
  const map: [keyof PdfInfo, string][] = [
    ['title', 'Title'],
    ['author', 'Author'],
    ['subject', 'Subject'],
    ['keywords', 'Keywords'],
    ['creator', 'Creator'],
    ['producer', 'Producer'],
    ['pdfVersion', 'PDFFormatVersion'],
  ];
  for (const [k, src] of map) {
    const v = str(pick(info, src));
    if (v) out[k] = v;
  }
  return out;
}

function readXmp(md: PdfjsMetadata | null): PdfXmp {
  if (!md) return {};
  const out: PdfXmp = {};
  const title = dedupeRepeat(str(md.get('dc:title')));
  if (title) out.title = title;
  const lang = md.get('dc:language');
  const langStr = Array.isArray(lang) ? str(lang[0]) : str(lang);
  if (langStr) out.language = langStr;
  const creators = md.get('dc:creator');
  if (Array.isArray(creators)) {
    const list = creators.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
    if (list.length) out.creators = list;
  }
  const part = Number.parseInt(String(md.get('pdfuaid:part') ?? ''), 10);
  if (Number.isFinite(part)) out.pdfuaPart = part;
  return out;
}

function pageText(items: unknown[]): string {
  let text = '';
  for (const item of items) {
    const s = pick(item, 'str');
    if (typeof s !== 'string') continue;
    text += s;
    if (pick(item, 'hasEOL') === true) text += '\n';
  }
  return text;
}

/** Text extent in mm from the left and top edges of the page box (unrotated pages only). */
function textBoxOf(items: unknown[], view: number[]): PdfPage['textBox'] | undefined {
  const [x0 = 0, , , y1 = 0] = view;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const s = pick(item, 'str');
    const t = pick(item, 'transform');
    const width = pick(item, 'width');
    if (typeof s !== 'string' || !s.trim() || !Array.isArray(t) || typeof width !== 'number')
      continue;
    const [, , , d = 0, e = 0, f = 0] = t as number[];
    const height = Math.abs(
      typeof pick(item, 'height') === 'number' ? (pick(item, 'height') as number) : d,
    );
    if (![e, f, width, height].every(Number.isFinite) || width <= 0) continue;
    left = Math.min(left, e - x0);
    right = Math.max(right, e - x0 + width);
    top = Math.min(top, y1 - (f + height));
    bottom = Math.max(bottom, y1 - f);
  }
  if (!Number.isFinite(left)) return undefined;
  const mm = (v: number) => Math.round(v * PT_TO_MM * 10) / 10;
  return { leftMm: mm(left), rightMm: mm(right), topMm: mm(top), bottomMm: mm(bottom) };
}

function collectFigures(node: unknown, page: number, out: PdfFigure[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as PdfjsStructNode;
  if (n.role === 'Figure') {
    const alt = str(n.alt);
    out.push(alt ? { page, alt } : { page });
  }
  if (Array.isArray(n.children)) for (const c of n.children) collectFigures(c, page, out);
}

/**
 * Extracts the facts Overfull checks from a PDF using an injected pdf.js.
 * The input buffer is copied, because pdf.js transfers (detaches) it.
 */
export async function extractPdfFacts(data: Uint8Array, pdfjs: PdfjsLike): Promise<PdfFacts> {
  const task = pdfjs.getDocument({
    data: data.slice(),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const { info, metadata } = await doc.getMetadata();
    const pdfInfo = readInfo(info);
    const xmp = readXmp(metadata);
    const markInfo = await doc.getMarkInfo().catch(() => null);
    const prefs = doc.getViewerPreferences
      ? await doc.getViewerPreferences().catch(() => null)
      : undefined;
    const pages: PdfPage[] = [];
    const figures: PdfFigure[] = [];
    let hasStructTree = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
      let w = Math.abs(x1 - x0) * PT_TO_MM;
      let h = Math.abs(y1 - y0) * PT_TO_MM;
      if ((page.rotate ?? 0) % 180 !== 0) [w, h] = [h, w];
      const content = await page.getTextContent();
      const box = (page.rotate ?? 0) % 360 === 0 ? textBoxOf(content.items, page.view) : undefined;
      pages.push({
        number: i,
        text: pageText(content.items),
        widthMm: Math.round(w * 10) / 10,
        heightMm: Math.round(h * 10) / 10,
        ...(box ? { textBox: box } : {}),
      });
      const tree = await page.getStructTree().catch(() => null);
      if (tree) {
        hasStructTree = true;
        collectFigures(tree, i, figures);
      }
      page.cleanup?.();
    }
    const language = str(pick(info, 'Language')) ?? xmp.language;
    const title = pdfInfo.title ?? xmp.title;
    const display = pick(prefs, 'DisplayDocTitle');
    const facts: PdfFacts = {
      pageCount: doc.numPages,
      pages,
      info: pdfInfo,
      xmp,
      tagged: pick(markInfo, 'Marked') === true,
      hasStructTree,
      figures,
    };
    if (language) facts.language = language;
    if (title) facts.title = title;
    if (typeof display === 'boolean') facts.displayDocTitle = display;
    else if (prefs === null) facts.displayDocTitle = false;
    if (xmp.pdfuaPart !== undefined) facts.pdfua = xmp.pdfuaPart;
    return facts;
  } finally {
    await (task.destroy ? task.destroy() : doc.destroy?.());
  }
}
