import type { Problem } from '../types.js';
import { parseAuxLabels } from './aux.js';
import type { VenueContext, VenueProfile } from './types.js';

const PAPER = {
  a4: { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
  letter: { w: 215.9, h: 279.4, label: 'US Letter (8.5 × 11 in)' },
} as const;
const TOLERANCE_MM = 3;

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
          message: `Main text ends on page ${page}, limit is ${max}`,
          location: { page },
          detail: `Counted up to \`\\label{${endLabel}}\`. Partial pages count as full pages.`,
          fix: `Cut ${page - max === 1 ? 'about a page' : `about ${page - max} pages`} before \`\\label{${endLabel}}\`, or move material to the appendix`,
          data: { pages: page, max, endLabel },
        });
      }
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
      fix: 'Build the PDF first (`overfull build`)',
    });
  } else if (total > max) {
    problems.push({
      rule: 'page-limit-exceeded',
      check: 'venue',
      severity: 'error',
      message: `PDF has ${total} pages, limit is ${max}`,
      fix: endLabel
        ? `Cut ${total - max} page(s), or fix \`\\label{${endLabel}}\` so only the main text is counted`
        : `Cut ${total - max} page(s), or set \`venue.pageLimit.endLabel\` if references/appendix do not count`,
      data: { pages: total, max },
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
    (p) => Math.abs(p.widthMm - target.w) > TOLERANCE_MM || Math.abs(p.heightMm - target.h) > TOLERANCE_MM,
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
      fix: want === 'a4' ? 'Use `\\documentclass[a4paper]{...}` or `\\usepackage[a4paper]{geometry}`' : 'Use `\\documentclass[letterpaper]{...}` or `\\usepackage[letterpaper]{geometry}`',
      data: { expected: want, widthMm: first.widthMm, heightMm: first.heightMm, pages: off.length },
    },
  ];
}
