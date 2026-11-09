import type { Problem } from '../types.js';
import { findCommands, grepTex } from './tex.js';
import type { VenueContext } from './types.js';

const ANON = /anonym|blind|submission|paper\s*id|author\s*names?\s*(hidden|withheld)/i;

/** Text of an `\author{...}` argument with commands, markup and separators removed. */
function authorText(arg: string): string {
  return arg
    .replace(/\\(and|And|AND|thanks|footnote|email|affil|inst|orcid)\b(\s*\{[^}]*\})?/g, ' ')
    .replace(/\\\\(\[[^\]]*\])?/g, ' ')
    .replace(/\\[A-Za-z@]+\*?/g, ' ')
    .replace(/[{}$^_~&,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function anonymityProblems(ctx: VenueContext): Problem[] {
  const problems: Problem[] = [];
  const pdfAuthor = ctx.facts?.info.author ?? ctx.facts?.xmp.creators?.join(', ');
  if (pdfAuthor && !ANON.test(pdfAuthor)) {
    problems.push({
      rule: 'anonymity-pdf-author',
      check: 'venue',
      severity: 'error',
      message: `PDF metadata names the author: "${pdfAuthor}"`,
      fix: 'Set `\\hypersetup{pdfauthor={Anonymous}}` (or remove `pdfauthor`) for the review version',
      data: { author: pdfAuthor },
    });
  }
  const files = ctx.texFiles ?? [];
  for (const use of findCommands(files, ['author'])) {
    const text = authorText(use.arg);
    if (!text || ANON.test(text)) continue;
    if (!/\p{L}{2,}/u.test(text)) continue;
    problems.push({
      rule: 'anonymity-author-named',
      check: 'venue',
      severity: 'error',
      message: `\\author names someone: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
      location: { file: use.file, line: use.line },
      fix: 'Use `\\author{Anonymous}` or the venue class’s review/anonymous option',
    });
  }
  const ack =
    /\\(?:section|chapter|subsection|paragraph|subsubsection)\*?\s*\{\s*Acknowledg|\\begin\{acknowledg|\\acknowledg(?:e)?ments\b/i;
  for (const hit of grepTex(files, ack)) {
    problems.push({
      rule: 'anonymity-acknowledgments',
      check: 'venue',
      severity: 'warning',
      message: 'Acknowledgments section in an anonymous submission',
      location: { file: hit.file, line: hit.line },
      fix: 'Remove or comment out acknowledgments until the camera-ready version',
    });
  }
  const self =
    /\b(?:our|my)\s+(?:previous|prior|earlier|own|recent)\s+(?:work|paper|papers|study|studies|publication|results?)\b/gi;
  for (const hit of grepTex(files, self)) {
    problems.push({
      rule: 'anonymity-self-reference',
      check: 'venue',
      severity: 'info',
      message: `Possible self-identification: "${hit.match}"`,
      location: { file: hit.file, line: hit.line },
      fix: 'Cite your earlier work in the third person ("Smith et al. [3] showed…")',
    });
  }
  return problems;
}
