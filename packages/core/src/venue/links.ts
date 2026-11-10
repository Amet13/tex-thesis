import type { Problem } from '../types.js';
import { stripComments } from './tex.js';
import type { VenueContext } from './types.js';

const URL_RE = /https?:\/\/[^\s{}\\|<>"^`]+/gi;

/** Anonymizing services: links to these are fine in a double-blind submission. */
const ANONYMIZERS = ['anonymous.4open.science'];

/** Code-hosting sites where the first path segment is a user or organization name. */
const USER_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];

function why(url: URL): string | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (ANONYMIZERS.some((a) => host === a || host.endsWith(`.${a}`))) return undefined;
  if (host === 'osf.io' && url.searchParams.has('view_only')) return undefined;
  if (USER_HOSTS.includes(host)) {
    const user = url.pathname.split('/').filter(Boolean)[0];
    return user ? `a ${host} page of "${user}"` : undefined;
  }
  if (host.endsWith('.github.io') || host.endsWith('.gitlab.io'))
    return `a personal page (${host})`;
  if (host === 'sites.google.com') return 'a personal Google Sites page';
  if (/^[^/]*\/~[^/]+/.test(`${host}${url.pathname}`)) return 'a personal page (a ~user path)';
  if (/(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/.test(host))
    return `an institutional page (${host})`;
  return undefined;
}

/**
 * `anonymity-link`: links in the source that can identify the authors: personal repositories,
 * personal and institutional pages. Class and style files are not read. Links to anonymizing
 * services are allowed. A link to someone else's repository or a university site is reported
 * as well, because the check cannot tell whose it is.
 */
export function anonymityLinkProblems(ctx: VenueContext): Problem[] {
  const out: Problem[] = [];
  for (const f of ctx.texFiles ?? []) {
    if (/\.(cls|sty)$/i.test(f.path)) continue;
    stripComments(f.content)
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(URL_RE)) {
          const raw = m[0].replace(/[.,;:)\]]+$/, '');
          let url: URL;
          try {
            url = new URL(raw);
          } catch {
            continue;
          }
          const reason = why(url);
          if (!reason) continue;
          out.push({
            rule: 'anonymity-link',
            check: 'venue',
            severity: 'warning',
            message: `Link to ${reason} can identify the authors: ${raw.slice(0, 80)}`,
            location: { file: f.path, line: i + 1 },
            fix: 'Use an anonymized copy (e.g. anonymous.4open.science), or remove the link for the review version. Ignore this if the link is not yours',
            data: { url: raw },
          });
        }
      });
  }
  return out;
}
