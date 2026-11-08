import { getCollection, type CollectionEntry } from 'astro:content';
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
