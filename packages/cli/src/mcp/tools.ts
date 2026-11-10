/**
 * The five MCP tools. Each one builds the argument list of the matching CLI
 * command from validated input and runs it in-process through `main` with an
 * in-memory Io, so behaviour and safety are those of the CLI: `cite` and
 * `pages` write only inside the project (safety.ts), and nothing from the
 * client chooses the working directory or an output path.
 */
import { closeSync, constants, openSync, readSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { CHECK_IDS } from '@overfull/core';
import { parseRange } from '../commands/pages.js';
import { type Io, UsageError } from '../io.js';
import { insideRoot, safeRelPath } from '../safety.js';

type Json = Record<string, unknown>;

export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image'; data: string; mimeType: 'image/png' };

export interface ToolOutput {
  content: (TextContent | ImageContent)[];
  structuredContent?: Json;
  isError?: boolean;
}

/** Runs the CLI like `overfull <argv>`; returns the exit code. */
export type Runner = (argv: string[], io: Io) => Promise<number>;

export interface ToolContext {
  cwd: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  run: Runner;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  run: (args: Json) => Promise<ToolOutput>;
}

/** What `tools/list` shows: the definition without the function. */
export function toolList(tools: ToolDef[]): Json[] {
  return tools.map(({ run: _run, ...def }) => ({ ...def }));
}

/**
 * Checks arguments against the small JSON Schema subset the tools use: an
 * object with typed properties, `required`, no extra properties. Returns a
 * message for the first problem, or undefined.
 */
export function validateArgs(schema: Json, args: Json): string | undefined {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(props, key)) return `unknown argument "${key.slice(0, 50)}"`;
  }
  for (const key of (schema.required as string[] | undefined) ?? []) {
    if (args[key] === undefined) return `"${key}" is required`;
  }
  for (const [key, spec] of Object.entries(props)) {
    const v = args[key];
    if (v === undefined) continue;
    const bad = (why: string) => `"${key}" ${why}`;
    switch (spec.type) {
      case 'string': {
        if (typeof v !== 'string') return bad('must be a string');
        if (v.length < ((spec.minLength as number | undefined) ?? 0)) return bad('is too short');
        if (v.length > (spec.maxLength as number)) return bad('is too long');
        if (typeof spec.pattern === 'string' && !new RegExp(spec.pattern).test(v))
          return bad(`has characters that are not allowed (pattern ${spec.pattern})`);
        break;
      }
      case 'boolean':
        if (typeof v !== 'boolean') return bad('must be true or false');
        break;
      case 'integer':
        if (!Number.isInteger(v)) return bad('must be an integer');
        if ((v as number) < (spec.minimum as number) || (v as number) > (spec.maximum as number))
          return bad(`must be between ${spec.minimum} and ${spec.maximum}`);
        break;
      case 'array': {
        if (!Array.isArray(v)) return bad('must be an array');
        if (v.length > (spec.maxItems as number)) return bad('has too many items');
        const allowed = (spec.items as Json).enum as string[];
        for (const item of v) {
          if (typeof item !== 'string' || !allowed.includes(item))
            return bad(`items must be one of: ${allowed.join(', ')}`);
        }
        break;
      }
    }
  }
  return undefined;
}

const text = (t: string): TextContent => ({ type: 'text', text: t });
const failure = (message: string): ToolOutput => ({ content: [text(message)], isError: true });
const asObject = (v: unknown): Json | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : undefined;

interface CliRun {
  code: number;
  out: string;
  err: string;
  json: unknown;
}

async function cli(ctx: ToolContext, argv: string[]): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd: ctx.cwd,
    env: { ...ctx.env, NO_COLOR: '1' },
    isTTY: false,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  };
  const code = await ctx.run(argv, io);
  const o = out.join('');
  let json: unknown;
  try {
    json = JSON.parse(o);
  } catch {
    json = undefined;
  }
  return { code, out: o, err: err.join(''), json };
}

/** The message the CLI printed for a failed command (JSON `error.message`, or stderr). */
function cliMessage(r: CliRun, what: string): string {
  const j = asObject(r.json);
  const e = asObject(j?.error);
  if (typeof e?.message === 'string') return e.message;
  if (typeof j?.message === 'string') return j.message;
  return r.err.trim() || `overfull ${what} failed (exit code ${r.code}).`;
}

function candidatesText(j: Json): string {
  const list = Array.isArray(j.candidates) ? j.candidates : [];
  return list
    .slice(0, 10)
    .map((c) => {
      const o = asObject(c) ?? {};
      const id = o.doi ? `doi ${o.doi}` : o.arxivId ? `arXiv:${o.arxivId}` : `${o.source}, no DOI`;
      return `  - ${o.title} (${Array.isArray(o.authors) ? o.authors[0] : 'unknown author'}${o.year ? `, ${o.year}` : ''}) — ${id}`;
    })
    .join('\n');
}

/** A JSON result as text (for every client) and as structuredContent (for those that read it). */
function jsonResult(value: unknown, wrap?: string): ToolOutput {
  const body = JSON.stringify(value);
  const structured = wrap ? { [wrap]: value } : asObject(value);
  return { content: [text(body)], ...(structured ? { structuredContent: structured } : {}) };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const IMAGE_MAX_COUNT = 5;
const IMAGE_MAX_BYTES = 600_000;
const IMAGE_TOTAL_BYTES = 1_800_000;
const PAGES_MAX = 20;

/** Reads a rendered page PNG, at most `limit` bytes; undefined when it is missing, odd or too big. */
function readPng(cwd: string, file: string, limit: number): Buffer | undefined {
  try {
    if (!/^page-\d+\.png$/.test(basename(file))) return undefined;
    const abs = insideRoot(cwd, resolve(cwd, file), 'page image');
    const fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buf = Buffer.alloc(limit + 1);
      let n = 0;
      for (;;) {
        const r = readSync(fd, buf, n, buf.length - n, null);
        if (r === 0) break;
        n += r;
        if (n > limit) return undefined;
      }
      return buf.subarray(0, n);
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

const noArgs = { type: 'object', properties: {}, additionalProperties: false };

export function createTools(ctx: ToolContext): ToolDef[] {
  const check: ToolDef = {
    name: 'check',
    title: 'Check the document',
    description:
      'Checks the built LaTeX document (log, PDF, references, accessibility, venue rules) and returns the same report as `overfull check --json`.',
    inputSchema: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: { type: 'string', enum: [...CHECK_IDS] },
          maxItems: CHECK_IDS.length,
          description: 'Only run these checks. Default: all of them.',
        },
        profile: {
          type: 'string',
          maxLength: 64,
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Venue profile, for example generic, thesis, paper, arxiv or double-blind.',
        },
        offline: {
          type: 'boolean',
          description: 'Do not look references up online (default false).',
        },
        main: {
          type: 'string',
          maxLength: 260,
          description:
            'Main .tex file, relative to the project. Default: from overfull.yml or detected.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: 'Check the document',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async run(args) {
      const argv = ['check', '--json'];
      const checks = args.checks as string[] | undefined;
      if (checks?.length) argv.push(`--checks=${checks.join(',')}`);
      if (str(args.profile)) argv.push(`--profile=${args.profile}`);
      if (args.offline === true) argv.push('--offline');
      const main = str(args.main);
      if (main !== undefined) {
        try {
          insideRoot(ctx.cwd, safeRelPath(main), 'Main file');
        } catch (e) {
          if (e instanceof UsageError) return failure(e.message);
          throw e;
        }
        argv.push(`--main=${main}`);
      }
      const r = await cli(ctx, argv);
      // Exit 1 is a report with failures: a result, not a tool error.
      if ((r.code === 0 || r.code === 1) && asObject(r.json)) return jsonResult(r.json);
      return failure(cliMessage(r, 'check'));
    },
  };

  const cite: ToolDef = {
    name: 'cite',
    title: 'Add a verified reference',
    description:
      'Looks a DOI, arXiv id or title up in the reference indexes and appends a verified BibTeX entry to the project bibliography, or writes nothing with dryRun.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'A DOI, an arXiv id (arXiv:1706.03762) or a title.',
        },
        key: {
          type: 'string',
          maxLength: 100,
          pattern: '^[A-Za-z0-9_:.+/-]+$',
          description: 'Citation key to use instead of the generated one.',
        },
        author: {
          type: 'string',
          maxLength: 100,
          description: 'Disambiguates a title: an author surname.',
        },
        year: {
          type: 'integer',
          minimum: 1000,
          maximum: 2999,
          description: 'Disambiguates a title: the publication year.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Show the entry without writing it (default false).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Add a verified reference',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async run(args) {
      const argv = ['cite', '--json'];
      if (str(args.key)) argv.push(`--key=${args.key}`);
      if (str(args.author)) argv.push(`--author=${args.author}`);
      if (typeof args.year === 'number') argv.push(`--year=${args.year}`);
      if (args.dryRun === true) argv.push('--dry-run');
      argv.push('--', args.query as string);
      const r = await cli(ctx, argv);
      const j = asObject(r.json);
      if (r.code === 0 && j) return jsonResult(j);
      if (j?.ambiguous === true) {
        return failure(
          `${cliMessage(r, 'cite')} Nothing was added.\n${candidatesText(j)}\n` +
            'Cite the right one by DOI, or call cite again with author/year. If none is right, ask the author.',
        );
      }
      return failure(cliMessage(r, 'cite'));
    },
  };

  const explain: ToolDef = {
    name: 'explain',
    title: 'Explain a rule',
    description:
      'Explains what a rule id means and how to fix it, or lists every rule id when no rule is given.',
    inputSchema: {
      type: 'object',
      properties: {
        rule: {
          type: 'string',
          maxLength: 100,
          description: 'A rule id from a check report. Omit it to list all rules.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: 'Explain a rule',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async run(args) {
      const rule = str(args.rule)?.trim();
      const r = await cli(
        ctx,
        rule ? ['explain', '--json', '--', rule] : ['explain', '--list', '--json'],
      );
      if (r.code !== 0 || r.json === undefined) return failure(cliMessage(r, 'explain'));
      return rule ? jsonResult(r.json) : jsonResult(r.json, 'rules');
    },
  };

  const pages: ToolDef = {
    name: 'pages',
    title: 'Render PDF pages',
    description:
      'Renders pages of the built PDF to PNG files inside the project and returns their paths, with the images themselves for up to five small pages.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: `Pages to render: "3", "2-5", "1,4,7" or "8-" (at most ${PAGES_MAX} pages).`,
        },
      },
      required: ['range'],
      additionalProperties: false,
    },
    annotations: {
      title: 'Render PDF pages',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async run(args) {
      const range = (args.range as string).trim();
      try {
        const wanted = parseRange(range);
        if (wanted.length > PAGES_MAX)
          return failure(`Too many pages: ask for at most ${PAGES_MAX} at a time.`);
      } catch (e) {
        if (e instanceof UsageError) return failure(e.message);
        throw e;
      }
      const r = await cli(ctx, ['pages', '--json', '--', range]);
      const j = asObject(r.json);
      const list = Array.isArray(j?.pages) ? (j.pages as Json[]) : undefined;
      if (r.code !== 0 || !list) return failure(cliMessage(r, 'pages'));
      const images: ImageContent[] = [];
      let total = 0;
      const files = list.map((p) => {
        const file = String(p.file);
        const entry: Json = { page: p.page, file, absolutePath: resolve(ctx.cwd, file) };
        if (images.length >= IMAGE_MAX_COUNT) {
          entry.image = 'not included (at most 5 images per call)';
          return entry;
        }
        const png = readPng(ctx.cwd, file, Math.min(IMAGE_MAX_BYTES, IMAGE_TOTAL_BYTES - total));
        if (!png) {
          entry.image = 'not included (too large to send); open the file instead';
          return entry;
        }
        total += png.length;
        images.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
        entry.image = 'included';
        return entry;
      });
      const body = { pages: files };
      return {
        content: [text(JSON.stringify(body)), ...images],
        structuredContent: body,
      };
    },
  };

  const doctor: ToolDef = {
    name: 'doctor',
    title: 'Check the tools',
    description:
      'Shows which tools Overfull can use on this machine (TeX, Docker, poppler, network) and whether overfull.yml is valid.',
    inputSchema: noArgs,
    annotations: {
      title: 'Check the tools',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async run() {
      const r = await cli(ctx, ['doctor', '--json']);
      // Exit 1 means "cannot build": still a report.
      if ((r.code === 0 || r.code === 1) && asObject(r.json)) return jsonResult(r.json);
      return failure(cliMessage(r, 'doctor'));
    },
  };

  return [check, cite, explain, pages, doctor];
}
