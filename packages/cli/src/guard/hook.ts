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
 * Not implemented, because the documentation did not confirm a usable payload:
 * Codex CLI (https://developers.openai.com/codex/hooks): file edits arrive as tool_name
 * "apply_patch" with the patch text in tool_input.command, and the patch format is not
 * documented there. Cursor (https://cursor.com/docs/agent/hooks): preToolUse can deny
 * a "Write", but the page does not show Write's tool_input fields.
 */

import { extname, isAbsolute, resolve } from 'node:path';

export const HOOK_HARNESSES = ['claude', 'gemini'] as const;
export type HookHarness = (typeof HOOK_HARNESSES)[number];

/** Payloads larger than this are not parsed (and are allowed). */
export const MAX_PAYLOAD_BYTES = 1024 * 1024;

export const DENY_REASON =
  'Direct edits to .bib files are blocked in this project, because a hand-written reference can be wrong or invented. ' +
  'Add a reference with `overfull cite <doi | arXiv:id | "title">`, which looks it up and writes a verified entry. ' +
  'If the author wants an entry the indexes do not know, they add it by hand outside the agent.';

export type HookDecision = { allow: true } | { allow: false; reason: string };

interface Adapter {
  /** Tool names that write a file, and the tool_input field holding the path. */
  writeTools: Record<string, string>;
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
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Picks the harness from the payload shape; undefined when it is none of the known ones. */
export function detectHarness(payload: unknown): HookHarness | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.hook_event_name === 'BeforeTool') return 'gemini';
  if (payload.hook_event_name === 'PreToolUse') return 'claude';
  const tool = payload.tool_name;
  if (typeof tool === 'string') {
    if (Object.hasOwn(ADAPTERS.gemini.writeTools, tool)) return 'gemini';
    if (Object.hasOwn(ADAPTERS.claude.writeTools, tool)) return 'claude';
  }
  return undefined;
}

/** True for a path whose extension is .bib, in any letter case. */
export function isBibPath(path: string): boolean {
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
  const target = input[field];
  if (typeof target !== 'string' || target === '' || target.includes('\0')) return allow;
  const base = typeof payload.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : cwd;
  const abs = isAbsolute(target) ? target : resolve(base, target);
  return isBibPath(abs) ? { allow: false, reason: DENY_REASON } : allow;
}

/**
 * The text to print for a decision: nothing for allow, one JSON line for deny.
 * The exit code is 0 either way.
 */
export function hookOutput(decision: HookDecision, harness: HookHarness): string {
  if (decision.allow) return '';
  return `${JSON.stringify(ADAPTERS[harness].deny(decision.reason))}\n`;
}

/** Parses stdin text; undefined when it is too large or not JSON. */
export function parsePayload(text: string): unknown {
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
