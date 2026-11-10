/** Where a command writes and what it knows about its environment. Injected for tests. */
export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** True when stdout is an interactive terminal. */
  isTTY: boolean;
  /** True when stderr is an interactive terminal (progress lines). Absent means no. */
  stderrIsTTY?: boolean;
  /** Overrides `globalThis.fetch` (tests, proxies). */
  fetch?: typeof fetch;
  /** Stops long-running commands (`check --watch`). The CLI wires it to Ctrl-C. */
  signal?: AbortSignal;
}

export function processIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    isTTY: Boolean(process.stdout.isTTY),
    stderrIsTTY: Boolean(process.stderr.isTTY),
  };
}

/** Thrown for bad usage or configuration: printed without a stack, exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function useColor(io: Io): boolean {
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '') return false;
  if (io.env.FORCE_COLOR && io.env.FORCE_COLOR !== '0') return true;
  return io.isTTY;
}

/**
 * A one-line progress writer for stderr, or undefined when stderr is not a
 * terminal. The line is rewritten in place and cleared when the work is done.
 */
export function progressLine(
  io: Io,
  label: string,
): ((done: number, total: number) => void) | undefined {
  if (!io.stderrIsTTY) return undefined;
  return (done, total) => {
    io.stderr(done >= total ? '\r\u001b[K' : `\r${label} ${done}/${total}`);
  };
}
