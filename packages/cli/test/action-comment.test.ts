/** G3: the Action's sticky pull request comment, against a fake GitHub API. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatMarkdown } from '@overfull/core';
import { describe, expect, it } from 'vitest';
import {
  COMMENT_LIMIT,
  COMMENT_MARKER,
  commentBody,
  upsertComment,
} from '../../../action/src/comment.js';
import { readInputs } from '../../../action/src/inputs.js';
import { tempDir } from './helpers.js';

interface Stored {
  id: number;
  body: string;
}

function fakeGitHub(initial: Stored[] = [], opts: { failWith?: number } = {}) {
  const comments = [...initial];
  const calls: { method: string; url: string; body?: string; auth?: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      method,
      url,
      ...(init?.body ? { body: String(init.body) } : {}),
      auth: headers?.Authorization,
    });
    if (opts.failWith) return new Response('nope', { status: opts.failWith });
    const u = new URL(url);
    if (method === 'GET') {
      const page = Number(u.searchParams.get('page') ?? 1);
      const per = Number(u.searchParams.get('per_page') ?? 30);
      return Response.json(comments.slice((page - 1) * per, page * per));
    }
    const text = (JSON.parse(String(init?.body)) as { body: string }).body;
    if (method === 'POST') {
      comments.push({ id: 1000 + comments.length, body: text });
      return Response.json({}, { status: 201 });
    }
    const id = Number(u.pathname.split('/').pop());
    const c = comments.find((x) => x.id === id);
    if (c) c.body = text;
    return Response.json({});
  }) as typeof fetch;
  return { fetch: f, comments, calls };
}

function prEnv(extra: Record<string, string> = {}) {
  const dir = tempDir();
  const event = join(dir, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: {
        number: 7,
        head: { repo: { full_name: 'o/r' } },
        base: { repo: { full_name: 'o/r' } },
      },
    }),
  );
  return {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_API_URL: 'https://api.example.test',
    ...extra,
  };
}

const run = (
  gh: ReturnType<typeof fakeGitHub>,
  env: Record<string, string>,
  markdown = '## Report\n',
  token: string | null = 'tok',
) => {
  const notices: string[] = [];
  return upsertComment({
    env,
    markdown,
    token: token ?? undefined,
    fetch: gh.fetch,
    notice: (m) => notices.push(m),
  }).then((outcome) => ({ outcome, notices }));
};

describe('sticky pull request comment', () => {
  it('creates the comment when none has the marker', async () => {
    const gh = fakeGitHub([{ id: 1, body: 'someone else' }]);
    const { outcome } = await run(gh, prEnv());
    expect(outcome).toBe('created');
    const post = gh.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('https://api.example.test/repos/o/r/issues/7/comments');
    expect(post?.auth).toBe('Bearer tok');
    expect(gh.comments.at(-1)?.body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('updates the existing comment instead of adding a second', async () => {
    const gh = fakeGitHub([{ id: 5, body: `${COMMENT_MARKER}\nold` }]);
    const { outcome } = await run(gh, prEnv(), '## New\n');
    expect(outcome).toBe('updated');
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]?.body).toContain('## New');
    expect(gh.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/comments/5'))).toBe(
      true,
    );
  });

  it('does not write when the comment is already current', async () => {
    const gh = fakeGitHub([{ id: 5, body: commentBody('## Same\n') }]);
    expect((await run(gh, prEnv(), '## Same\n')).outcome).toBe('unchanged');
    expect(gh.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('looks through several pages of comments', async () => {
    const many: Stored[] = Array.from({ length: 230 }, (_, i) => ({ id: i + 1, body: `c${i}` }));
    many[205] = { id: 206, body: `${COMMENT_MARKER}\nold` };
    const gh = fakeGitHub(many);
    expect((await run(gh, prEnv())).outcome).toBe('updated');
    expect(gh.calls.filter((c) => c.method === 'GET')).toHaveLength(3);
    expect(gh.comments).toHaveLength(230);
  });

  it('does nothing outside pull requests', async () => {
    const gh = fakeGitHub();
    const { outcome, notices } = await run(gh, prEnv({ GITHUB_EVENT_NAME: 'push' }));
    expect(outcome).toBe('skipped');
    expect(gh.calls).toHaveLength(0);
    expect(notices.join(' ')).toContain('Not a pull request');
  });

  it('skips pull requests from forks with a notice', async () => {
    const dir = tempDir();
    const event = join(dir, 'e.json');
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          number: 7,
          head: { repo: { full_name: 'fork/r' } },
          base: { repo: { full_name: 'o/r' } },
        },
      }),
    );
    const gh = fakeGitHub();
    const { outcome, notices } = await run(gh, prEnv({ GITHUB_EVENT_PATH: event }));
    expect(outcome).toBe('skipped');
    expect(gh.calls).toHaveLength(0);
    expect(notices.join(' ')).toContain('fork');
  });

  it('a failing API (403, 500, thrown fetch) gives a notice, never an exception', async () => {
    for (const status of [403, 500]) {
      const { outcome, notices } = await run(fakeGitHub([], { failWith: status }), prEnv());
      expect(outcome).toBe('failed');
      expect(notices.join(' ')).toContain(`HTTP ${status}`);
    }
    const notices: string[] = [];
    const outcome = await upsertComment({
      env: prEnv(),
      markdown: 'x',
      token: 'tok',
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
      notice: (m) => notices.push(m),
    });
    expect(outcome).toBe('failed');
    expect(notices.join(' ')).not.toContain('tok"');
  });

  it('without a token it skips with a notice', async () => {
    const gh = fakeGitHub();
    expect((await run(gh, prEnv(), 'x', null)).outcome).toBe('skipped');
    expect(gh.calls).toHaveLength(0);
  });

  it('truncates to the size limit and says so', () => {
    const big = `${'line of report text\n'.repeat(5000)}`;
    const body = commentBody(big);
    expect(body.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('cut to fit');
  });

  it('document text cannot forge the marker or a workflow command', () => {
    const body = commentBody(
      formatMarkdown({
        tool: 'overfull',
        version: '3.1.0',
        status: 'fail',
        checks: [
          {
            check: 'build',
            status: 'fail',
            problems: [
              {
                rule: 'x',
                check: 'build',
                severity: 'error',
                message: `${COMMENT_MARKER}\n::error::boom`,
              },
            ],
          },
        ],
      }),
    );
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
    expect(body).not.toMatch(/^::/m);
  });
});

describe('action inputs for comment and sarif', () => {
  it('default to off', () => {
    const i = readInputs({}, '/w');
    expect(i.comment).toBe(false);
    expect(i.sarif).toBeUndefined();
  });
  it('read comment, sarif and the token', () => {
    const i = readInputs(
      { INPUT_COMMENT: 'true', INPUT_SARIF: 'out/o.sarif', 'INPUT_GITHUB-TOKEN': 't' },
      '/w',
    );
    expect(i).toMatchObject({ comment: true, sarif: 'out/o.sarif', githubToken: 't' });
  });
});
