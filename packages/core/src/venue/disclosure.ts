import type { Problem } from '../types.js';
import { findCommands, grepTex } from './tex.js';
import type { Level, VenueContext } from './types.js';

const AI = /\b(AI|LLMs?|large\s+language\s+models?|generative|artificial\s+intelligence|GenAI|ChatGPT)\b/i;
const USE = /\b(use|usage|used|disclosure|statement|declaration|assist\w*|tools?)\b/i;

function isDisclosureTitle(title: string): boolean {
  return AI.test(title) && USE.test(title);
}

/** True when the source or PDF contains an AI-use disclosure heading or label. */
export function hasDisclosure(ctx: VenueContext): boolean {
  const files = ctx.texFiles ?? [];
  if (grepTex(files, /\\label\s*\{overfull:disclosure\}/).length > 0) return true;
  const headings = findCommands(files, [
    'section',
    'subsection',
    'subsubsection',
    'paragraph',
    'chapter',
    'addsec',
  ]);
  if (headings.some((h) => isDisclosureTitle(h.arg))) return true;
  if (files.length === 0 && ctx.facts) {
    return ctx.facts.pages.some((p) => p.text.split('\n').some((l) => l.length < 80 && isDisclosureTitle(l)));
  }
  return false;
}

export function disclosureProblems(level: Level | undefined, ctx: VenueContext): Problem[] {
  if (!level || level === 'off') return [];
  if (!ctx.texFiles?.length && !ctx.facts) return [];
  if (hasDisclosure(ctx)) return [];
  return [
    {
      rule: 'disclosure-missing',
      check: 'venue',
      severity: level === 'required' ? 'error' : 'info',
      message:
        level === 'required'
          ? 'No AI-use disclosure statement found (required by this venue)'
          : 'No AI-use disclosure statement found (many venues now ask for one)',
      fix: 'Add a short section such as `\\section*{Use of Generative AI}\\label{overfull:disclosure}` stating which tools were used and how',
    },
  ];
}
