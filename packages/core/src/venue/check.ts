import { type CheckResult, statusOf } from '../types.js';
import { anonymityProblems } from './anonymity.js';
import { arxivProblems } from './arxiv.js';
import { disclosureProblems } from './disclosure.js';
import { pageLimitProblems, pageLimitText, paperSizeProblems } from './pages.js';
import type { VenueContext, VenueProfile } from './types.js';

/** Runs the venue rules a profile enables. */
export function venueCheck(profile: VenueProfile, ctx: VenueContext): CheckResult {
  if (!ctx.facts && !ctx.texFiles?.length && !ctx.aux) {
    return {
      check: 'venue',
      status: 'skipped',
      problems: [],
      skippedReason: 'No PDF or .tex sources to check',
    };
  }
  const problems = [
    ...pageLimitProblems(profile, ctx),
    ...paperSizeProblems(profile, ctx),
    ...(profile.anonymous ? anonymityProblems(ctx) : []),
    ...disclosureProblems(profile.disclosure, ctx),
    ...(profile.arxiv ? arxivProblems(ctx) : []),
  ];
  const stats: Record<string, number> = {};
  if (ctx.facts) stats.pages = ctx.facts.pageCount;
  if (profile.pageLimit) stats.pageLimit = profile.pageLimit.max;
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  const parts = [`profile ${profile.id}`];
  const limitText = pageLimitText(profile, ctx);
  if (limitText) parts.push(limitText);
  else if (ctx.facts) parts.push(`${ctx.facts.pageCount} pages`);
  if (errors) parts.push(`${errors} to fix`);
  if (warnings) parts.push(`${warnings} to review`);
  return { check: 'venue', status: statusOf(problems), problems, summary: parts.join(', '), stats };
}
