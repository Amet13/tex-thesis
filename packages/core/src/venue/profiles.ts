import { CHECK_IDS } from '../types.js';
import type { InlineProfile, VenueProfile } from './types.js';

const ALL_CHECKS = [...CHECK_IDS];

export const builtinProfiles: Record<string, VenueProfile> = {
  generic: {
    id: 'generic',
    name: 'Generic',
    description: 'Any LaTeX document: build, output, references; accessibility as advice.',
    paper: 'any',
    disclosure: 'off',
    accessibility: 'recommended',
    checks: ALL_CHECKS,
  },
  thesis: {
    id: 'thesis',
    name: 'Thesis',
    description: 'Theses and dissertations: accessible PDF/UA output required, no page limit.',
    paper: 'any',
    disclosure: 'off',
    accessibility: 'required',
    checks: ALL_CHECKS,
  },
  paper: {
    id: 'paper',
    name: 'Paper',
    description: 'Conference or journal paper: AI-use disclosure and accessibility recommended.',
    paper: 'any',
    disclosure: 'recommended',
    accessibility: 'recommended',
    checks: ALL_CHECKS,
  },
  arxiv: {
    id: 'arxiv',
    name: 'arXiv',
    description: 'arXiv submission: no absolute paths, no shell escape, .bbl included, pdfLaTeX-safe figures.',
    paper: 'any',
    disclosure: 'off',
    accessibility: 'recommended',
    arxiv: true,
    checks: ALL_CHECKS,
  },
  'double-blind': {
    id: 'double-blind',
    name: 'Double-blind review',
    description: 'Anonymous submission: no author names in the PDF metadata or source, no acknowledgments.',
    paper: 'any',
    anonymous: true,
    disclosure: 'recommended',
    accessibility: 'recommended',
    checks: ALL_CHECKS,
  },
};

export class UnknownProfileError extends Error {
  constructor(name: string) {
    super(
      `Unknown profile "${name}". Built-in profiles: ${Object.keys(builtinProfiles).join(', ')}`,
    );
    this.name = 'UnknownProfileError';
  }
}

function builtin(name: string): VenueProfile {
  const p = builtinProfiles[name];
  if (!p) throw new UnknownProfileError(name);
  return p;
}

/**
 * Resolves a profile by name, or an inline profile whose fields override a
 * built-in (`extends`, default `generic`; or `id` when it names a built-in).
 * Throws `UnknownProfileError` for unknown names.
 */
export function resolveProfile(nameOrInline: string | InlineProfile): VenueProfile {
  if (typeof nameOrInline === 'string') return { ...builtin(nameOrInline) };
  const { extends: base, ...inline } = nameOrInline;
  const baseName = base ?? (inline.id && builtinProfiles[inline.id] ? inline.id : 'generic');
  const parent = builtin(baseName);
  const merged: VenueProfile = { ...parent };
  for (const [k, v] of Object.entries(inline)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  if (inline.pageLimit) merged.pageLimit = { ...parent.pageLimit, ...inline.pageLimit };
  if (!inline.id) merged.id = parent.id;
  return merged;
}
