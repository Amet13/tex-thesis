import type { VenueProfileData } from './types.js';
import { venueProfileData } from './venues.generated.js';

/** Base name of a path, lower-cased. */
function baseName(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).toLowerCase();
}

/**
 * Venue profile ids whose data names `fileName` (a path or base name, case-insensitive) as a
 * required style file. Built from the profile data, so a new `venues/*.yml` is picked up
 * without code changes. Used to suggest a profile for a project that already contains a
 * venue's style file.
 */
export function profilesForStyleFile(
  fileName: string,
  profiles: Record<string, VenueProfileData> = venueProfileData,
): string[] {
  const want = baseName(fileName);
  return Object.values(profiles)
    .filter((p) => p.styleFiles?.some((f) => baseName(f.name) === want))
    .map((p) => p.id)
    .sort();
}

/** The whole mapping: lower-case style file name to the sorted profile ids that name it. */
export function styleFileIndex(
  profiles: Record<string, VenueProfileData> = venueProfileData,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of Object.values(profiles)) {
    for (const f of p.styleFiles ?? []) {
      const key = baseName(f.name);
      const ids = out[key] ?? [];
      if (!ids.includes(p.id)) ids.push(p.id);
      out[key] = ids.sort();
    }
  }
  return out;
}
