/** Where a command writes and what it knows about its environment. Injected for tests. */
export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** True when stdout is an interactive terminal. */
  isTTY: boolean;
  /** Overrides `globalThis.fetch` (tests, proxies). */
  fetch?: typeof fetch;
}

export function processIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    isTTY: Boolean(process.stdout.isTTY),
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
