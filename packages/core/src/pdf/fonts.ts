import type { PdfFont } from './types.js';

/**
 * Parses `pdffonts` output (poppler). Name and type come from the fixed-width
 * columns given by the dashed separator; the yes/no flags are read from the
 * right so an over-long font name cannot shift them.
 */
export function parsePdffonts(text: string): PdfFont[] {
  const lines = text.split(/\r?\n/);
  const sepIndex = lines.findIndex((l) => /^-{4,}( -+)+\s*$/.test(l));
  if (sepIndex < 0) return [];
  const sep = lines[sepIndex] ?? '';
  const starts: number[] = [];
  const re = /-+/g;
  for (let m = re.exec(sep); m; m = re.exec(sep)) starts.push(m.index);
  const typeStart = starts[1] ?? 37;
  const encStart = starts[2] ?? 55;
  const fonts: PdfFont[] = [];
  for (const line of lines.slice(sepIndex + 1)) {
    if (!line.trim()) continue;
    const tokens = line.trim().split(/\s+/);
    const n = tokens.length;
    if (n < 6) continue;
    const flag = (i: number) => tokens[n - i] === 'yes';
    const overflow = line.length > typeStart && line[typeStart - 1] !== ' ';
    const name = overflow ? (tokens[0] ?? '') : line.slice(0, typeStart).trim();
    const type = overflow ? '' : line.slice(typeStart, encStart).trim();
    fonts.push({ name, type, embedded: flag(5), subset: flag(4), unicode: flag(3) });
  }
  return fonts;
}
