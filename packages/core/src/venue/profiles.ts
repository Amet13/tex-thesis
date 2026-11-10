import { CHECK_IDS } from '../types.js';
import type { InlineProfile, VenueProfile, VenueProfileData } from './types.js';
import { venueProfileData } from './venues.generated.js';

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
    description:
      'Conference or journal paper: AI-use disclosure recommended, accessible (tagged) PDF required.',
    paper: 'any',
    disclosure: 'recommended',
    accessibility: 'required',
    checks: ALL_CHECKS,
  },
  arxiv: {
    id: 'arxiv',
    name: 'arXiv',
    description:
      'arXiv submission: no absolute paths, no shell escape, .bbl included, pdfLaTeX-safe figures.',
    paper: 'any',
    disclosure: 'off',
    accessibility: 'recommended',
    arxiv: true,
    checks: ALL_CHECKS,
  },
  'double-blind': {
    id: 'double-blind',
    name: 'Double-blind review',
    description:
      'Anonymous submission: no author names in the PDF metadata or source, no acknowledgments.',
    paper: 'any',
    anonymous: true,
    disclosure: 'recommended',
    accessibility: 'recommended',
    checks: ALL_CHECKS,
  },
};

export class UnknownProfileError extends Error {
  constructor(name: string, extra: Record<string, VenueProfileData> = venueProfileData) {
    const venues = Object.keys({ ...venueProfileData, ...extra });
    super(
      `Unknown profile "${name}". Built-in profiles: ${Object.keys(builtinProfiles).join(', ')}` +
        (venues.length ? `. Venue profiles: ${venues.join(', ')}` : ''),
    );
    this.name = 'UnknownProfileError';
  }
}

type Registry = Record<string, VenueProfileData>;

/** Merges `inline` over `parent`; `pageLimit` merges field by field. */
function merge(parent: VenueProfile, inline: Partial<VenueProfile>): VenueProfile {
  const merged: VenueProfile = { ...parent };
  for (const [k, v] of Object.entries(inline)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  if (inline.pageLimit) merged.pageLimit = { ...parent.pageLimit, ...inline.pageLimit };
  if (!inline.id) merged.id = parent.id;
  return merged;
}

/** True when `name` is a built-in profile or a venue profile. */
function known(name: string, venues: Registry): boolean {
  return Object.hasOwn(builtinProfiles, name) || Object.hasOwn(venues, name);
}

function lookup(name: string, venues: Registry): VenueProfile {
  const built = Object.hasOwn(builtinProfiles, name) ? builtinProfiles[name] : undefined;
  if (built) return { ...built };
  const data = Object.hasOwn(venues, name) ? venues[name] : undefined;
  if (!data) throw new UnknownProfileError(name, venues);
  const { extends: base, ...fields } = data;
  const parent = lookup(base ?? 'generic', venues);
  const withDescription = {
    description: `${data.name}${data.year !== undefined ? ` (${data.year})` : ''}`,
    ...fields,
  };
  return merge(parent, withDescription);
}

/**
 * Resolves a profile by name, or an inline profile whose fields override a
 * built-in or venue profile (`extends`, default `generic`; or `id` when it names
 * one). Venue profiles come from `venues/*.yml` (compiled into
 * `venues.generated.ts`); `venues` replaces that set, which tests use.
 * Throws `UnknownProfileError` for unknown names.
 */
export function resolveProfile(
  nameOrInline: string | InlineProfile,
  venues: Registry = venueProfileData,
): VenueProfile {
  if (typeof nameOrInline === 'string') return lookup(nameOrInline, venues);
  const { extends: base, ...inline } = nameOrInline;
  const baseName = base ?? (inline.id && known(inline.id, venues) ? inline.id : 'generic');
  return merge(lookup(baseName, venues), inline);
}
