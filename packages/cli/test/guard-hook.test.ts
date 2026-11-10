/** `overfull guard --hook`: payload fixtures per harness, fail-open behaviour, settings wiring. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guardCommand } from '../src/commands/guard.js';
import { detectHarness, MAX_PAYLOAD_BYTES, runHook } from '../src/guard/hook.js';
import { mergeHookSettings } from '../src/guard/settings.js';
import { main } from '../src/main.js';
import { memIo } from './helpers.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/guard/${name}`, import.meta.url), 'utf8');
const repo = fileURLToPath(new URL('../../../', import.meta.url));

async function hook(args: string[], stdin: string) {
  const io = memIo('/work/paper');
  const code = await guardCommand(['--hook', ...args], io, async () => stdin);
  return { code, out: io.stdoutText(), err: io.stderrText() };
}

describe('guard --hook, Claude Code', () => {
  const denied = [
    'claude-write-bib.json',
    'claude-edit-bib.json',
    'claude-edit-bib-relative.json',
    'claude-multiedit-bib.json',
  ];
  for (const name of denied) {
    it(`denies ${name} in the documented PreToolUse format`, async () => {
      for (const args of [[], ['claude']]) {
        const r = await hook(args, fixture(name));
        expect(r.code).toBe(0);
        const out = JSON.parse(r.out);
        expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
        expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
        expect(out.hookSpecificOutput.permissionDecisionReason).toContain('overfull cite');
        // The payload's content is never echoed back.
        expect(r.out).not.toContain('Invented');
      }
    });
  }

  const allowed = [
    'claude-edit-tex.json',
    'claude-read-bib.json',
    'claude-bash-bib.json',
    'claude-write-bib-lookalike.json',
    'claude-malformed.json',
    'claude-wrong-types.json',
    'codex-apply-patch-bib.json',
  ];
  for (const name of allowed) {
    it(`allows ${name} (exit 0, no output)`, async () => {
      for (const args of [[], ['claude']]) {
        const r = await hook(args, fixture(name));
        expect(r).toEqual({ code: 0, out: '', err: '' });
      }
    });
  }
});

describe('guard --hook, Gemini CLI', () => {
  for (const name of ['gemini-write-file-bib.json', 'gemini-replace-bib.json']) {
    it(`denies ${name} in the documented BeforeTool format`, async () => {
      for (const args of [[], ['gemini']]) {
        const r = await hook(args, fixture(name));
        expect(r.code).toBe(0);
        const out = JSON.parse(r.out);
        expect(out.decision).toBe('deny');
        expect(out.reason).toContain('overfull cite');
        expect(r.out).not.toContain('Invented');
      }
    });
  }
  for (const name of [
    'gemini-write-file-tex.json',
    'gemini-read-bib.json',
    'gemini-malformed.json',
  ]) {
    it(`allows ${name}`, async () => {
      expect(await hook([], fixture(name))).toEqual({ code: 0, out: '', err: '' });
    });
  }
  it('a Gemini payload is not denied by the claude adapter, and the reverse', async () => {
    expect((await hook(['claude'], fixture('gemini-write-file-bib.json'))).out).toBe('');
    expect((await hook(['gemini'], fixture('claude-write-bib.json'))).out).toBe('');
  });
});

describe('guard --hook, general', () => {
  it('detects the harness from the payload', () => {
    expect(detectHarness(JSON.parse(fixture('claude-write-bib.json')))).toBe('claude');
    expect(detectHarness(JSON.parse(fixture('gemini-write-file-bib.json')))).toBe('gemini');
    expect(detectHarness(null)).toBeUndefined();
    expect(detectHarness([])).toBeUndefined();
    expect(detectHarness({ tool_name: 'Frobnicate' })).toBeUndefined();
  });

  it('resolves relative paths against the payload cwd, and the extension in any case', () => {
    const p = (file_path: string, cwd = '/work/paper') =>
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        cwd,
        tool_input: { file_path },
      });
    expect(runHook(p('a.BiB'), undefined, '/').decision.allow).toBe(false);
    expect(runHook(p('a.bib.tex'), undefined, '/').decision.allow).toBe(true);
    expect(runHook(p('.bib'), undefined, '/').decision.allow).toBe(true);
    expect(runHook(p('x\0.bib'), undefined, '/').decision.allow).toBe(true);
    expect(runHook(p(''), undefined, '/').decision.allow).toBe(true);
  });

  it('allows everything that is not understood', async () => {
    for (const text of ['', 'null', '[]', '"x"', '42', '{}', '{"tool_name":7}', 'x'.repeat(50)]) {
      expect(await hook([], text)).toEqual({ code: 0, out: '', err: '' });
    }
    const huge = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/a/b.bib', content: 'x'.repeat(MAX_PAYLOAD_BYTES) },
    });
    expect((await hook([], huge)).out).toBe('');
  });

  it('allows when reading stdin fails', async () => {
    const io = memIo('/work');
    const code = await guardCommand(['--hook'], io, async () => {
      throw new Error('stdin closed');
    });
    expect(code).toBe(0);
    expect(io.stdoutText()).toBe('');
  });

  it('rejects an unknown harness name and a missing mode', async () => {
    expect(await main(['guard', '--hook', 'vim'], memIo('/work'))).toBe(2);
    expect(await main(['guard'], memIo('/work'))).toBe(2);
    expect(await main(['guard', '--staged', '--hook'], memIo('/work'))).toBe(2);
  });

  it('has help that names both modes and the shell limitation', async () => {
    const io = memIo('/work');
    expect(await main(['guard', '--help'], io)).toBe(0);
    expect(io.stdoutText()).toContain('--staged');
    expect(io.stdoutText()).toContain('--hook');
    expect(io.stdoutText()).toContain('shell command');
    const top = memIo('/work');
    await main(['--help'], top);
    expect(top.stdoutText()).toContain('guard --staged | --hook');
  });
});

describe('hook settings files', () => {
  const claude = readFileSync(join(repo, 'shared/agents/.claude/settings.json'), 'utf8');
  const gemini = readFileSync(join(repo, 'shared/agents/.gemini/settings.json'), 'utf8');

  it('call overfull guard --hook, and do nothing when overfull is not installed', () => {
    const c = JSON.parse(claude).hooks.PreToolUse[0];
    expect(c.matcher).toBe('Write|Edit|MultiEdit');
    expect(c.hooks[0].command).toContain('command -v overfull');
    expect(c.hooks[0].command).toContain('overfull guard --hook claude');
    expect(c.hooks[0].command).toMatch(/\|\| exit 0$/);
    const g = JSON.parse(gemini).hooks.BeforeTool[0];
    expect(g.matcher).toBe('write_file|replace');
    expect(g.hooks[0].command).toContain('overfull guard --hook gemini');
  });

  it('the plugin manifest carries the same hook as the Claude settings', () => {
    const plugin = JSON.parse(readFileSync(join(repo, '.claude-plugin/plugin.json'), 'utf8'));
    expect(plugin.hooks).toEqual(JSON.parse(claude).hooks);
  });

  it('merging keeps other keys and other hooks, and is idempotent', () => {
    const existing = JSON.stringify({
      permissions: { allow: ['Bash(make:*)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'true' }] }],
      },
    });
    const first = mergeHookSettings(existing, claude);
    expect(first.error).toBeUndefined();
    const merged = JSON.parse(first.text as string);
    expect(merged.permissions).toEqual({ allow: ['Bash(make:*)'] });
    expect(merged.hooks.Stop).toHaveLength(1);
    expect(merged.hooks.PreToolUse).toHaveLength(2);
    expect(merged.hooks.PreToolUse[0].hooks[0].command).toBe('echo hi');
    expect(mergeHookSettings(first.text as string, claude)).toEqual({});
    expect(mergeHookSettings('{', claude).error).toContain('not valid JSON');
    expect(mergeHookSettings('[]', claude).error).toBeDefined();
    expect(mergeHookSettings('{"hooks":[]}', claude).error).toBeDefined();
  });
});
