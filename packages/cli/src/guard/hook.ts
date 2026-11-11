/**
 * `overfull guard --hook`: answers an agent harness's pre-tool-use hook.
 *
 * The payload is untrusted JSON from stdin. It is only read: nothing in it is
 * executed, file contents in it are never echoed back, and anything that is not
 * recognised (unknown harness, other tool, malformed JSON, no path) is allowed.
 * A guard that breaks the agent's other tools is worse than none.
 *
 * Harness formats, read from the official documentation on 2026-11-10:
 *
 * Claude Code, https://code.claude.com/docs/en/hooks (PreToolUse)
 *   stdin: { hook_event_name: "PreToolUse", tool_name, tool_input, cwd, ... }.
 *   Write: tool_input.file_path, content. Edit: tool_input.file_path, old_string,
 *   new_string, replace_all. (MultiEdit and NotebookEdit are not described on the
 *   page; they are matched by name and read the same path fields, so a .bib path
 *   is denied and nothing else changes.)
 *   deny: exit 0 with stdout
 *   { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
 *     permissionDecisionReason } }. The reason is shown to Claude.
 *   allow: exit 0 and no output ("no decision": the normal permission flow runs).
 *   Settings: .claude/settings.json, hooks.PreToolUse[{ matcher, hooks: [{ type: "command", command }] }].
 *
 * Gemini CLI, https://geminicli.com/docs/hooks/ and https://geminicli.com/docs/hooks/reference/
 *   (BeforeTool); tools: https://geminicli.com/docs/tools/file-system/
 *   stdin: { hook_event_name: "BeforeTool", tool_name, tool_input, cwd, ... }.
 *   write_file and replace take tool_input.file_path.
 *   deny: exit 0 with stdout { decision: "deny", reason }; the reason is sent to the agent.
 *   allow: exit 0 and no output.
 *   Settings: .gemini/settings.json, hooks.BeforeTool[{ matcher, hooks: [{ name, type: "command", command, timeout }] }].
 *
 * Codex CLI, https://developers.openai.com/codex/hooks (PreToolUse)
 *   stdin: { hook_event_name: "PreToolUse", turn_id, tool_name, tool_input, cwd, ... }.
 *   File edits arrive as tool_name "apply_patch" with the patch text in
 *   tool_input.command. The patch grammar is the "official Lark grammar" in Codex's own
 *   parser (github.com/openai/codex, codex-rs/apply-patch/src/parser.rs, read 2026-11-10):
 *   files are named on "*** Add File: ", "*** Delete File: ", "*** Update File: " and
 *   "*** Move to: " lines (the parser allows whitespace around markers).
 *   deny: exit 0 with the same hookSpecificOutput shape as Claude Code.
 *   Settings: <repo>/.codex/hooks.json, hooks.PreToolUse[{ matcher, hooks: [{ type, command }] }];
 *   project hooks load only when the project's .codex/ layer is trusted.
 *
 * Not implemented, because the documentation did not confirm a usable payload:
 * Cursor (https://cursor.com/docs/agent/hooks, read 2026-11-10): preToolUse can deny a
 * "Write", but the page does not show Write's tool_input fields; afterFileEdit names the
 * file but runs after the edit and cannot block it.
 */

import { extname, isAbsolute, resolve } from 'node:path';

export const HOOK_HARNESSES = ['claude', 'gemini', 'codex'] as const;
export type HookHarness = (typeof HOOK_HARNESSES)[number];

/** Payloads larger than this are not parsed (and are allowed). */
export const MAX_PAYLOAD_BYTES = 1024 * 1024;

const DENY_REASON =
  'Direct edits to .bib files are blocked in this project, because a hand-written reference can be wrong or invented. ' +
  'Add a reference with `overfull cite <doi | arXiv:id | "title">`, which looks it up and writes a verified entry. ' +
  'If the author wants an entry the indexes do not know, they add it by hand outside the agent.';

export type HookDecision = { allow: true } | { allow: false; reason: string };

interface Adapter {
  /** Tool names that write a file, and the tool_input field holding the path. */
  writeTools: Record<string, string>;
  /** Paths named by a tool call when they are not in one field (Codex patches). */
  paths?: (tool: string, input: Record<string, unknown>) => string[];
  /** The harness's answer to a denied call (stdout; exit code 0). */
  deny(reason: string): unknown;
}

const ADAPTERS: Record<HookHarness, Adapter> = {
  claude: {
    writeTools: {
      Write: 'file_path',
      Edit: 'file_path',
      MultiEdit: 'file_path',
      NotebookEdit: 'notebook_path',
    },
    deny: (reason) => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  },
  gemini: {
    writeTools: { write_file: 'file_path', replace: 'file_path' },
    deny: (reason) => ({ decision: 'deny', reason }),
  },
  codex: {
    writeTools: { apply_patch: 'command' },
    paths: (_tool, input) => (typeof input.command === 'string' ? patchPaths(input.command) : []),
    deny: (reason) => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  },
};

const PATCH_FILE_MARKERS = [
  '*** Add File: ',
  '*** Delete File: ',
  '*** Update File: ',
  '*** Move to: ',
];

/** Files a Codex apply_patch text adds, deletes, updates or moves to. */
function patchPaths(patch: string): string[] {
  const out: string[] = [];
  for (const raw of patch.split('\n')) {
    const line = raw.trim();
    for (const marker of PATCH_FILE_MARKERS) {
      if (line.startsWith(marker)) {
        const path = line.slice(marker.length).trim();
        if (path) out.push(path);
      }
    }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Picks the harness from the payload shape; undefined when it is none of the known ones. */
export function detectHarness(payload: unknown): HookHarness | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.hook_event_name === 'BeforeTool') return 'gemini';
  // Codex and Claude Code both send PreToolUse; Codex adds turn_id and names edits apply_patch.
  if (payload.tool_name === 'apply_patch' || typeof payload.turn_id === 'string') return 'codex';
  if (payload.hook_event_name === 'PreToolUse') return 'claude';
  const tool = payload.tool_name;
  if (typeof tool === 'string') {
    if (Object.hasOwn(ADAPTERS.gemini.writeTools, tool)) return 'gemini';
    if (Object.hasOwn(ADAPTERS.claude.writeTools, tool)) return 'claude';
  }
  return undefined;
}

/** True for a path whose extension is .bib, in any letter case. */
function isBibPath(path: string): boolean {
  return extname(path).toLowerCase() === '.bib';
}

/**
 * Decides one payload. `harness` is the adapter to use, or undefined to detect it.
 * `cwd` is where relative paths resolve when the payload has no `cwd` of its own.
 */
export function decide(
  payload: unknown,
  harness: HookHarness | undefined,
  cwd: string,
): HookDecision {
  const allow: HookDecision = { allow: true };
  const kind = harness ?? detectHarness(payload);
  if (!kind || !isRecord(payload)) return allow;
  const adapter = ADAPTERS[kind];
  const tool = payload.tool_name;
  if (typeof tool !== 'string' || !Object.hasOwn(adapter.writeTools, tool)) return allow;
  const input = payload.tool_input;
  if (!isRecord(input)) return allow;
  const field = adapter.writeTools[tool] as string;
  const targets = adapter.paths ? adapter.paths(tool, input) : [input[field]];
  const base = typeof payload.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : cwd;
  for (const target of targets) {
    if (typeof target !== 'string' || target === '' || target.includes('\0')) continue;
    const abs = isAbsolute(target) ? target : resolve(base, target);
    if (isBibPath(abs)) return { allow: false, reason: DENY_REASON };
  }
  return allow;
}

/**
 * The text to print for a decision: nothing for allow, one JSON line for deny.
 * The exit code is 0 either way.
 */
function hookOutput(decision: HookDecision, harness: HookHarness): string {
  if (decision.allow) return '';
  return `${JSON.stringify(ADAPTERS[harness].deny(decision.reason))}\n`;
}

/** Parses stdin text; undefined when it is too large or not JSON. */
function parsePayload(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The whole `--hook` step: stdin text in, text to print out (empty means allow). */
export function runHook(
  stdinText: string,
  harness: HookHarness | undefined,
  cwd: string,
): { output: string; harness: HookHarness | undefined; decision: HookDecision } {
  const payload = parsePayload(stdinText);
  const kind = harness ?? detectHarness(payload);
  const decision = decide(payload, kind, cwd);
  return { output: kind ? hookOutput(decision, kind) : '', harness: kind, decision };
}
