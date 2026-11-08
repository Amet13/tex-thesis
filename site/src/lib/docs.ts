import { type CollectionEntry, getCollection } from 'astro:content';
import { DOC_SECTIONS } from './paths';

export type Doc = CollectionEntry<'docs'>;

function sectionRank(s: string): number {
  const i = (DOC_SECTIONS as readonly string[]).indexOf(s);
  return i < 0 ? DOC_SECTIONS.length : i;
}

/** All guide pages in reading order: by section, then `order`, then title. */
export async function sortedDocs(): Promise<Doc[]> {
  const docs = await getCollection('docs');
  return docs.sort(
    (a, b) =>
      sectionRank(a.data.section) - sectionRank(b.data.section) ||
      a.data.order - b.data.order ||
      a.data.title.localeCompare(b.data.title),
  );
}

export function groupDocs(docs: Doc[]): { section: string; docs: Doc[] }[] {
  const out: { section: string; docs: Doc[] }[] = [];
  for (const d of docs) {
    const last = out[out.length - 1];
    if (last && last.section === d.data.section) last.docs.push(d);
    else out.push({ section: d.data.section, docs: [d] });
  }
  return out;
}

export function docSlug(d: Doc): string {
  return d.id.replace(/(^|\/)index$/, '').toLowerCase();
}

export function docPath(d: Doc): string {
  const s = docSlug(d);
  return s ? `docs/${s}/` : 'docs/';
}

const REPO_BLOB = 'https://github.com/amet13/overfull/blob/main';

/**
 * Rewrites links between guide pages in rendered HTML: `./checks.md#refs`
 * becomes `<base>docs/checks/#refs`; links that leave docs/guide go to GitHub.
 */
export function rewriteDocLinks(html: string, d: Doc, base: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const dir = d.id.includes('/') ? d.id.slice(0, d.id.lastIndexOf('/') + 1) : '';
  return html.replace(/href="([^"]+)"/g, (all, href: string) => {
    if (/^[a-z]+:|^\/\/|^#|^\//i.test(href)) return all;
    const [pathPart = '', hash = ''] = href.split('#');
    if (!pathPart.endsWith('.md')) return all;
    const out: string[] = [];
    for (const p of (dir + pathPart).split('/')) {
      if (p === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else out.push('..');
      } else if (p && p !== '.') out.push(p);
    }
    const h = hash ? `#${hash}` : '';
    if (out[0] === '..') {
      let up = 0;
      while (out[0] === '..') {
        out.shift();
        up++;
      }
      return `href="${REPO_BLOB}/${up === 1 ? 'docs/' : ''}${out.join('/')}${h}"`;
    }
    const slug = out
      .join('/')
      .replace(/\.md$/, '')
      .toLowerCase()
      .replace(/(^|\/)index$/, '');
    return `href="${prefix}docs/${slug ? `${slug}/` : ''}${h}"`;
  });
}

export interface DocHeading {
  depth: number;
  slug: string;
  text: string;
}

export function docHeadings(d: Doc | undefined): DocHeading[] {
  const h = d?.rendered?.metadata?.headings;
  return Array.isArray(h) ? (h as DocHeading[]) : [];
}
