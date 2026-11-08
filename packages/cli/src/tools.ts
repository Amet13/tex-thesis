import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Absolute path of an executable on PATH, or undefined. */
export function which(cmd: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return undefined;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Set when the command could not be started (ENOENT…). */
  error?: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Called with each output line (stdout and stderr) as it arrives. */
  onLine?: (line: string) => void;
}

/** Runs a command without a shell, capturing output. Never throws. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let pending = '';
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined;
    const feed = (chunk: string) => {
      if (!opts.onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) opts.onLine(l);
    };
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      stdout += d;
      feed(d);
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr += d;
      feed(d);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: 127, stdout, stderr, error: err.message });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (pending && opts.onLine) opts.onLine(pending);
      resolvePromise({ code: code ?? (signal ? 124 : 1), stdout, stderr });
    });
  });
}

/** True when the Docker daemon answers. */
export async function dockerAvailable(env?: Record<string, string | undefined>): Promise<boolean> {
  if (!which('docker', env)) return false;
  const r = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8000 });
  return r.code === 0;
}

export async function dockerImagePresent(image: string): Promise<boolean> {
  const r = await run('docker', ['image', 'inspect', image], { timeoutMs: 8000 });
  return r.code === 0;
}

/** Arguments for `docker run` that mount `dir` at /work as the current user. */
export function dockerRunArgs(image: string, dir: string, command: string[]): string[] {
  const user =
    typeof process.getuid === 'function' && typeof process.getgid === 'function'
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : [];
  return ['run', '--rm', ...user, '-e', 'HOME=/tmp', '-v', `${dir}:/work`, '-w', '/work', image, ...command];
}
