import { readFileSync } from 'node:fs';

declare const __OVERFULL_VERSION__: string | undefined;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** CLI version; injected at bundle time for the Action (`__OVERFULL_VERSION__`). */
export const VERSION: string =
  typeof __OVERFULL_VERSION__ === 'string' ? __OVERFULL_VERSION__ : readVersion();
