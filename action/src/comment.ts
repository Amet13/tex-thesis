import { readFileSync } from 'node:fs';

/** Hidden marker that identifies the one comment this Action owns on a pull request. */
export const COMMENT_MARKER = '<!-- overfull-report -->';

/** GitHub rejects comment bodies over 65,536 characters; stay clear of the limit. */
export const COMMENT_LIMIT = 65_000;

const TRUNCATED =
  "\n\n</details>\n\n_The report was cut to fit GitHub's comment size limit. The full report is in the job summary and the `report` output._\n";

export type CommentOutcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';

export interface CommentOptions {
  env: Record<string, string | undefined>;
  /** Markdown from `formatMarkdown`, already neutralized. */
  markdown: string;
  token: string | undefined;
  fetch?: typeof fetch;
  /** Called with a plain one-line message for the log (a notice, never an error). */
  notice: (message: string) => void;
}

interface PullRequestEvent {
  number?: number;
  pull_request?: {
    number?: number;
    head?: { repo?: { full_name?: string } | null };
    base?: { repo?: { full_name?: string } | null };
  };
}

/** The comment body: marker first, then the report, cut to GitHub's limit with a note. */
export function commentBody(markdown: string): string {
  const full = `${COMMENT_MARKER}\n${markdown}`;
  if (full.length <= COMMENT_LIMIT) return full;
  const room = COMMENT_LIMIT - TRUNCATED.length;
  let cut = full.slice(0, room);
  // Do not end inside a surrogate pair or in the middle of a line.
  const nl = cut.lastIndexOf('\n');
  if (nl > COMMENT_MARKER.length) cut = cut.slice(0, nl);
  return `${cut}${TRUNCATED}`;
}

function pullRequestNumber(env: CommentOptions['env']): number | undefined {
  let event: PullRequestEvent | undefined;
  try {
    if (env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    /* fall through to GITHUB_REF */
  }
  const fromEvent = event?.pull_request?.number ?? event?.number;
  if (Number.isInteger(fromEvent) && (fromEvent as number) > 0) return fromEvent;
  const m = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');
  return m ? Number(m[1]) : undefined;
}

function isFork(env: CommentOptions['env']): boolean {
  try {
    if (!env.GITHUB_EVENT_PATH) return false;
    const pr = (JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as PullRequestEvent)
      .pull_request;
    const head = pr?.head?.repo?.full_name;
    const base = pr?.base?.repo?.full_name;
    return Boolean(head && base && head !== base);
  } catch {
    return false;
  }
}

/**
 * Creates or updates the single Overfull comment on the pull request. Never
 * throws: commenting is a courtesy, so any failure becomes a notice.
 */
export async function upsertComment(o: CommentOptions): Promise<CommentOutcome> {
  const { env } = o;
  const event = env.GITHUB_EVENT_NAME;
  if (event !== 'pull_request' && event !== 'pull_request_target') {
    o.notice('Not a pull request event: no comment written.');
    return 'skipped';
  }
  const number = pullRequestNumber(env);
  const repo = env.GITHUB_REPOSITORY;
  if (!number || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    o.notice('Could not tell which pull request this is: no comment written.');
    return 'skipped';
  }
  if (!o.token) {
    o.notice('No github-token: no comment written.');
    return 'skipped';
  }
  if (event === 'pull_request' && isFork(env)) {
    o.notice(
      'This pull request comes from a fork, so the token cannot write comments: no comment written. The job summary has the report.',
    );
    return 'skipped';
  }
  const doFetch = o.fetch ?? globalThis.fetch;
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const headers = {
    Authorization: `Bearer ${o.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'overfull-action',
    'Content-Type': 'application/json',
  };
  const base = `${api}/repos/${repo}/issues`;
  const body = commentBody(o.markdown);
  try {
    let existing: { id: number; body?: string } | undefined;
    for (let page = 1; page <= 50 && !existing; page++) {
      const res = await doFetch(`${base}/${number}/comments?per_page=100&page=${page}`, {
        headers,
      });
      if (!res.ok) throw new Error(`listing comments failed: HTTP ${res.status}`);
      const batch = (await res.json()) as { id: number; body?: string }[];
      existing = batch.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));
      if (batch.length < 100) break;
    }
    if (existing) {
      if (existing.body === body) return 'unchanged';
      const res = await doFetch(`${base}/comments/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`updating the comment failed: HTTP ${res.status}`);
      return 'updated';
    }
    const res = await doFetch(`${base}/${number}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`creating the comment failed: HTTP ${res.status}`);
    return 'created';
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    o.notice(
      `Could not write the pull request comment (${why}). The step continues. Commenting needs \`pull-requests: write\`.`,
    );
    return 'failed';
  }
}
