import type { Problem } from '../types.js';
import { parseAuxLabels } from './aux-file.js';
import type { VenueContext, VenueProfile } from './types.js';

const PAPER = {
  a4: { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
  letter: { w: 215.9, h: 279.4, label: 'US Letter (8.5 × 11 in)' },
} as const;
const TOLERANCE_MM = 3;

/** Last page of the main text: the page of the end label from the .aux, when it is a number. */
export function mainTextPages(profile: VenueProfile, ctx: VenueContext): number | undefined {
  const endLabel = profile.pageLimit?.endLabel;
  if (!endLabel || !ctx.aux) return undefined;
  const entry = parseAuxLabels(ctx.aux).get(endLabel);
  return entry && /^\d+$/.test(entry.page) ? Number(entry.page) : undefined;
}

/**
 * The page-limit line used in messages and the venue summary:
 * "main text 7 of 8 pages (12 total)", or "12 of 8 pages" when all pages count.
 */
export function pageLimitText(profile: VenueProfile, ctx: VenueContext): string | undefined {
  const max = profile.pageLimit?.max;
  if (max === undefined) return undefined;
  const total = ctx.facts?.pageCount;
  const main = mainTextPages(profile, ctx);
  if (main !== undefined)
    return `main text ${main} of ${max} pages${total !== undefined ? ` (${total} total)` : ''}`;
  return total !== undefined ? `${total} of ${max} pages` : undefined;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Page-limit problems. Counts all pages, or up to the page of the end label. */
export function pageLimitProblems(profile: VenueProfile, ctx: VenueContext): Problem[] {
  const limit = profile.pageLimit;
  if (!limit) return [];
  const problems: Problem[] = [];
  const { max, endLabel } = limit;
  if (endLabel) {
    const entry = ctx.aux ? parseAuxLabels(ctx.aux).get(endLabel) : undefined;
    if (entry && /^\d+$/.test(entry.page)) {
      const page = Number(entry.page);
      if (page > max) {
        problems.push({
          rule: 'page-limit-exceeded',
          check: 'venue',
          severity: 'error',
          message: `${cap(pageLimitText(profile, ctx) as string)}: the main text ends on page ${page}`,
          location: { page },
          detail: `Counted up to \`\\label{${endLabel}}\`. Partial pages count as full pages.`,
          fix: `Cut ${page - max === 1 ? 'about a page' : `about ${page - max} pages`} before \`\\label{${endLabel}}\`, or move material to the appendix`,
          data: { pages: page, max, endLabel },
        });
      }
      problems.push(...floatsAfterEnd(ctx.aux ?? '', page, endLabel));
      return problems;
    }
    problems.push({
      rule: 'page-limit-label-missing',
      check: 'venue',
      severity: 'warning',
      message: entry
        ? `\\label{${endLabel}} is on page "${entry.page}", which is not a page number; counted all pages`
        : `\\label{${endLabel}} not found in the .aux; counted all pages`,
      fix: `Put \`\\label{${endLabel}}\` right after the last line of the main text (before references/appendix) and rebuild`,
      data: { endLabel },
    });
  }
  const total = ctx.facts?.pageCount;
  if (total === undefined) {
    problems.push({
      rule: 'page-limit-unchecked',
      check: 'venue',
      severity: 'info',
      message: `Page limit (${max}) not checked: no PDF`,
      fix: 'Build the PDF first: `overfull build` locally, or an earlier step of your CI workflow',
    });
  } else if (total > max) {
    problems.push({
      rule: 'page-limit-exceeded',
      check: 'venue',
      severity: 'error',
      message: `${cap(pageLimitText(profile, ctx) as string)} (all pages counted)`,
      fix: endLabel
        ? `Cut ${total - max} page(s), or fix \`\\label{${endLabel}}\` so only the main text is counted`
        : `Cut ${total - max} page(s), or set \`venue.pageLimit.endLabel\` if references/appendix do not count`,
      data: { pages: total, max },
    });
  }
  return problems;
}

const FLOAT_LABEL = /^(fig|figure|tab|table):/i;
const APPENDIX_LABEL = /^(?:app|appendix)\b|^app(?:endix)?[:._-]|[:._-]app(?:endix)?(?:[:._-]|$)/i;

/**
 * Figures and tables of the main text that LaTeX floated past the end label. Appendix
 * floats are skipped: labels named `app…`/`appendix…`, numbered like `A.1`, or on or
 * after the page of the first appendix label.
 */
function floatsAfterEnd(aux: string, endPage: number, endLabel: string): Problem[] {
  const labels = parseAuxLabels(aux);
  const pageOf = (p: string) => (/^\d+$/.test(p) ? Number(p) : undefined);
  let appendixPage = Number.POSITIVE_INFINITY;
  for (const [name, l] of labels) {
    const page = pageOf(l.page);
    if (page !== undefined && !FLOAT_LABEL.test(name) && APPENDIX_LABEL.test(name)) {
      appendixPage = Math.min(appendixPage, page);
    }
  }
  const problems: Problem[] = [];
  for (const [name, l] of labels) {
    if (!FLOAT_LABEL.test(name) || APPENDIX_LABEL.test(name.replace(FLOAT_LABEL, ''))) continue;
    if (/^[A-Z](?:\.|$)/.test(l.ref)) continue;
    const page = pageOf(l.page);
    if (page === undefined || page <= endPage || page >= appendixPage) continue;
    const kind = /^(fig|figure):/i.test(name) ? 'Figure' : 'Table';
    problems.push({
      rule: 'float-after-main-end',
      check: 'venue',
      severity: 'warning',
      message: `${kind} ${name} floated to page ${page}, after the end of the main text (page ${endPage}); it may not count toward the page limit but reviewers will see it outside the main text`,
      location: { page },
      fix: `Place the ${kind.toLowerCase()} earlier (\`[t]\` or \`[htbp]\`, or move it closer to where it is first referenced) so it lands before \`\\label{${endLabel}}\`, or move it to the appendix on purpose`,
      data: { label: name, page, endPage, endLabel },
    });
  }
  return problems;
}

/** Paper-size mismatch (warning), checked on every page; reports the first offender. */
export function paperSizeProblems(profile: VenueProfile, ctx: VenueContext): Problem[] {
  const want = profile.paper;
  if (!want || want === 'any' || !ctx.facts) return [];
  const target = PAPER[want];
  const off = ctx.facts.pages.filter(
    (p) =>
      Math.abs(p.widthMm - target.w) > TOLERANCE_MM ||
      Math.abs(p.heightMm - target.h) > TOLERANCE_MM,
  );
  const first = off[0];
  if (!first) return [];
  const other = want === 'a4' ? 'letter' : 'a4';
  const isOther =
    Math.abs(first.widthMm - PAPER[other].w) <= TOLERANCE_MM &&
    Math.abs(first.heightMm - PAPER[other].h) <= TOLERANCE_MM;
  const size = isOther ? PAPER[other].label : `${first.widthMm} × ${first.heightMm} mm`;
  return [
    {
      rule: 'paper-size-mismatch',
      check: 'venue',
      severity: 'warning',
      message: `Page ${first.number} is ${size}, venue expects ${target.label}${off.length > 1 ? ` (${off.length} pages differ)` : ''}`,
      location: { page: first.number },
      fix:
        want === 'a4'
          ? 'Use `\\documentclass[a4paper]{...}` or `\\usepackage[a4paper]{geometry}`'
          : 'Use `\\documentclass[letterpaper]{...}` or `\\usepackage[letterpaper]{geometry}`',
      data: { expected: want, widthMm: first.widthMm, heightMm: first.heightMm, pages: off.length },
    },
  ];
}
