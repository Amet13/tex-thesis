import { parseVeraPdfReport, type VeraPdfResult } from '@overfull/core';
import { run, which } from './tools.js';

/**
 * Runs veraPDF (PDF/UA-2, falling back to PDF/UA-1 for PDFs older than 2.0)
 * and parses its JSON report. Returns null when veraPDF is not installed.
 */
export async function runVeraPdf(
  pdf: string,
  env?: Record<string, string | undefined>,
): Promise<VeraPdfResult | null> {
  if (!which('verapdf', env)) return null;
  const attempt = async (flavour: string) => {
    const r = await run('verapdf', ['--flavour', flavour, '--format', 'json', pdf], {
      timeoutMs: 180000,
    });
    if (r.error) return { compliant: false, failures: [], error: r.error } satisfies VeraPdfResult;
    return parseVeraPdfReport(r.stdout || r.stderr);
  };
  const ua2 = await attempt('ua2');
  if (!ua2.error) return ua2;
  const ua1 = await attempt('ua1');
  return ua1.error ? ua2 : ua1;
}
