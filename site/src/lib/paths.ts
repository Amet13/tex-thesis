/** Site-relative URL that respects `base` (e.g. `/overfull/`). */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const clean = path.replace(/^\/+/, '');
  return base + clean;
}

export const REPO_URL = 'https://github.com/amet13/overfull';

export const DOC_SECTIONS = [
  'Start',
  'With an agent',
  'By hand',
  'Checks',
  'Reference',
  'Project',
] as const;

export const CHECK_LABELS: Record<string, { name: string; blurb: string }> = {
  build: {
    name: 'Build',
    blurb:
      'TeX errors from the log, grouped by root cause, with the file and line that caused them.',
  },
  output: {
    name: 'Output',
    blurb:
      'What reaches the PDF: ?? for undefined references, [?] citations, missing figures, overfull lines, stale bibliographies.',
  },
  references: {
    name: 'References',
    blurb:
      'Every bibliography entry looked up in CrossRef, doi.org, arXiv and DBLP. Entries no index knows are reported, never silently kept.',
  },
  accessibility: {
    name: 'Accessibility',
    blurb:
      'Tagged PDF, document language and title, alt text on figures, and a PDF/UA validation with veraPDF when it is installed.',
  },
  venue: {
    name: 'Venue',
    blurb:
      'Page limit, paper size, anonymity for double-blind review, AI-use disclosure, arXiv packaging rules.',
  },
};
