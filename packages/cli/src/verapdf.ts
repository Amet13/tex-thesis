import { relative } from 'node:path';
import { parseVeraPdfReport, type VeraPdfResult } from '@overfull/core';
import { dockerToolArgs, quoteWindowsArg, run, which } from './tools.js';

/** Runs a tool inside the Overfull image, with the project root mounted at /work. */
export interface DockerTools {
  image: string;
  root: string;
}

/** veraPDF flavour for the PDF/UA part a file claims: 1 → ua1; 2 or none → ua2. */
export function verapdfFlavour(pdfuaPart: number | undefined): 'ua1' | 'ua2' {
  return pdfuaPart === 1 ? 'ua1' : 'ua2';
}

/**
 * Runs veraPDF and parses its JSON report. The flavour follows the PDF's own
 * `pdfuaid:part` claim (a valid PDF/UA-1 file is not judged as UA-2). Uses a
 * local veraPDF, else the Overfull image when `docker` is given; returns null
 * when neither is available.
 */
export async function runVeraPdf(
  pdf: string,
  env?: Record<string, string | undefined>,
  opts: { pdfuaPart?: number; docker?: DockerTools } = {},
): Promise<VeraPdfResult | null> {
  // On Windows veraPDF ships as verapdf.bat, run below through the shell with quoted fixed arguments.
  const local = which('verapdf', env, { allowBatch: true });
  if (!local && !opts.docker) return null;
  const win = process.platform === 'win32';
  const attempt = async (flavour: string) => {
    const args = ['--flavour', flavour, '--format', 'json'];
    let r: Awaited<ReturnType<typeof run>>;
    if (local) {
      // On Windows veraPDF is a .bat wrapper, which needs a shell; the
      // arguments are fixed apart from the (quoted) PDF path.
      let quoted: string[] = [];
      try {
        if (win) quoted = [...args, pdf].map(quoteWindowsArg);
      } catch (err) {
        return { compliant: false, failures: [], error: String(err) } satisfies VeraPdfResult;
      }
      r = win
        ? await run('verapdf', quoted, {
            timeoutMs: 180000,
            shell: true,
          })
        : await run('verapdf', [...args, pdf.startsWith('-') ? `./${pdf}` : pdf], {
            timeoutMs: 180000,
          });
    } else {
      const { image, root } = opts.docker as DockerTools;
      const rel = `./${relative(root, pdf).split('\\').join('/')}`;
      r = await run('docker', dockerToolArgs(image, root, 'verapdf', [...args, rel]), {
        timeoutMs: 300000,
      });
      if (r.code === 125)
        return {
          compliant: false,
          failures: [],
          error: `docker could not run ${image}: ${r.stderr.trim().split('\n').pop() ?? ''}`,
        } satisfies VeraPdfResult;
    }
    if (r.error) return { compliant: false, failures: [], error: r.error } satisfies VeraPdfResult;
    return parseVeraPdfReport(r.stdout || r.stderr);
  };
  const flavour = verapdfFlavour(opts.pdfuaPart);
  const first = await attempt(flavour);
  if (!first.error || opts.pdfuaPart !== undefined) return first;
  // No claim and UA-2 could not run (e.g. a PDF older than 2.0): try UA-1.
  const ua1 = await attempt('ua1');
  return ua1.error ? first : ua1;
}
