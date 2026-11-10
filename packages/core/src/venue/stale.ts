import type { Problem } from '../types.js';
import type { VenueProfile } from './types.js';

/** A profile is flagged when its `checkedOn` date is more than this many months old. */
export const STALE_AFTER_MONTHS = 14;

/** Info note when the venue profile was last compared with the official pages long ago. */
export function staleProfileProblems(profile: VenueProfile, now: Date): Problem[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(profile.checkedOn ?? '');
  if (!m) return [];
  const checked = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const limit = new Date(checked);
  limit.setUTCMonth(limit.getUTCMonth() + STALE_AFTER_MONTHS);
  if (now.getTime() <= limit.getTime()) return [];
  return [
    {
      rule: 'venue-profile-stale',
      check: 'venue',
      severity: 'info',
      message: `Profile ${profile.id} was last checked against the venue's pages on ${profile.checkedOn}; it may be out of date`,
      fix: `Read the venue's current instructions${profile.source?.length ? ` (${profile.source.join(', ')})` : ''} before you submit`,
      data: { profile: profile.id, checkedOn: profile.checkedOn, months: STALE_AFTER_MONTHS },
    },
  ];
}
