import { parseArgs, type ParseArgsConfig } from 'node:util';
import { UsageError } from './io.js';

type Options = NonNullable<ParseArgsConfig['options']>;

export interface Parsed {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
}

/** Strict parseArgs with `--help`, turning unknown flags into a UsageError. */
export function parse(args: string[], options: Options, command: string): Parsed {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { help: { type: 'boolean', short: 'h' }, ...options },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Parsed['values'], positionals };
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/\. To specify.*$/s, '') : String(err);
    throw new UsageError(`${msg}\nRun \`overfull ${command} --help\` for usage.`);
  }
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function list(v: unknown): string[] | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function int(v: unknown, name: string): number | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${name} must be a positive integer, got "${s}"`);
  return n;
}
