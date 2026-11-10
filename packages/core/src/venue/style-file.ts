import { sha256Hex } from '../refs/sha256.js';
import type { Problem } from '../types.js';
import type { TexFile, VenueProfile } from './types.js';

const baseName = (path: string) => path.split('/').pop() ?? path;

/**
 * `style-file-modified`: the project's copy of a style file the profile names differs from the
 * recorded SHA-256. Only style files with a recorded hash are compared. A copy with Windows line
 * endings is compared as well after converting them to `\n`, so a git checkout is not flagged.
 */
export function styleFileProblems(profile: VenueProfile, files: TexFile[]): Problem[] {
  const problems: Problem[] = [];
  for (const sf of profile.styleFiles ?? []) {
    if (!sf.sha256) continue;
    const want = sf.sha256.toLowerCase();
    for (const f of files) {
      if (baseName(f.path) !== sf.name) continue;
      if (sha256Hex(f.content) === want) continue;
      if (f.content.includes('\r\n') && sha256Hex(f.content.replace(/\r\n/g, '\n')) === want)
        continue;
      problems.push({
        rule: 'style-file-modified',
        check: 'venue',
        severity: 'warning',
        message: `${f.path} differs from the official ${sf.name} for ${profile.name}`,
        location: { file: f.path },
        detail: `Expected SHA-256 ${want}. Venues often reject papers built with a changed style file.`,
        fix: `Download ${sf.name} again from the venue's page and keep your changes in your own files`,
        data: { file: f.path, styleFile: sf.name, expected: want },
      });
    }
  }
  return problems;
}
