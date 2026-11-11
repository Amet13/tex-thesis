import type { Problem } from '../types.js';
import { findCommands, grepTex, stripComments } from './tex.js';
import type { Level, TexFile, VenueContext } from './types.js';

const AI =
  /\b(AI|LLMs?|large\s+language\s+models?|generative|artificial\s+intelligence|GenAI|ChatGPT)\b/i;
const USE = /\b(use|usage|used|disclosure|statement|declaration|assist\w*|tools?)\b/i;
const HEADINGS = ['section', 'subsection', 'subsubsection', 'paragraph', 'chapter', 'addsec'];
/** Text that marks an unfinished statement. */
const PLACEHOLDER =
  /\b(placeholder|todo|tbd|tbc|lorem ipsum|xxx+|fill (this|in))\b|\[(describe|write|insert)[^\]]*\]/i;
/** A real statement says at least this much (characters of plain text). */
const MIN_STATEMENT_CHARS = 40;

function isDisclosureTitle(title: string): boolean {
  return AI.test(title) && USE.test(title);
}

interface Found {
  file: string;
  line: number;
  /** Plain-ish text of the section body; undefined when only the PDF was available. */
  body?: string;
}

/** Text from `start` to the next heading, `\end{document}` or end of file, with markup removed. */
function sectionBody(src: string, start: number): string {
  const rest = src.slice(start);
  const next = rest.search(
    /\\(section|subsection|subsubsection|paragraph|chapter|addsec|appendix|printbibliography|bibliography)\b|\\end\{document\}/,
  );
  const raw = next < 0 ? rest : rest.slice(0, next);
  return raw
    .replace(/\\label\s*\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyAfterHeading(f: TexFile, line: number): string {
  const src = stripComments(f.content);
  const lines = src.split('\n');
  const offset = lines.slice(0, line - 1).join('\n').length;
  // Skip the heading command itself (up to the end of its closing brace on that line).
  const headingEnd = src.indexOf('}', offset);
  return sectionBody(src, headingEnd < 0 ? offset : headingEnd + 1);
}

/** Locates the AI-use disclosure: a `\label{overfull:disclosure}` or a heading that names it. */
function findDisclosure(ctx: VenueContext): Found | null {
  const files = ctx.texFiles ?? [];
  const label = grepTex(files, /\\label\s*\{overfull:disclosure\}/)[0];
  const heading = findCommands(files, HEADINGS).find((h) => isDisclosureTitle(h.arg));
  const hit = heading ?? label;
  if (hit) {
    const f = files.find((x) => x.path === hit.file);
    return {
      file: hit.file,
      line: hit.line,
      ...(f ? { body: bodyAfterHeading(f, hit.line) } : {}),
    };
  }
  if (files.length === 0 && ctx.facts) {
    const page = ctx.facts.pages.findIndex((p) =>
      p.text.split('\n').some((l) => l.length < 80 && isDisclosureTitle(l)),
    );
    if (page >= 0) return { file: '', line: 0 };
  }
  return null;
}

/** True when the source or PDF contains an AI-use disclosure heading or label. */
export function hasDisclosure(ctx: VenueContext): boolean {
  return findDisclosure(ctx) !== null;
}

export function disclosureProblems(level: Level | undefined, ctx: VenueContext): Problem[] {
  if (!level || level === 'off') return [];
  if (!ctx.texFiles?.length && !ctx.facts) return [];
  const found = findDisclosure(ctx);
  if (!found) {
    return [
      {
        rule: 'disclosure-missing',
        check: 'venue',
        severity: level === 'required' ? 'error' : 'info',
        message:
          level === 'required'
            ? 'No AI-use disclosure statement found (required by this venue)'
            : 'No AI-use disclosure statement found (many venues now ask for one)',
        fix: 'Add a short section such as `\\section*{Use of Generative AI}\\label{overfull:disclosure}`. The author writes the statement: which AI tools were used and for what, and that the authors checked the output. Only the author can say whether none were used.',
      },
    ];
  }
  if (found.body === undefined) return [];
  const unfinished = PLACEHOLDER.test(found.body) || found.body.length < MIN_STATEMENT_CHARS;
  if (!unfinished) return [];
  return [
    {
      rule: 'disclosure-placeholder',
      check: 'venue',
      severity: level === 'required' ? 'error' : 'warning',
      message: 'The AI-use disclosure is still a placeholder or nearly empty',
      location: { file: found.file, line: found.line },
      detail: `The section reads: "${found.body.slice(0, 120)}${found.body.length > 120 ? '…' : ''}"`,
      fix: 'The author writes the statement: which AI tools were used and for what, and that the authors checked the output. Only the author can say whether none were used.',
    },
  ];
}
