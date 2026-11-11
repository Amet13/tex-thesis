/**
 * Reads corpus/<id>/{case.json, main.tex, main.log} at build time. Each case is
 * a minimal LaTeX document that CI compiles on TeX Live to prove a rule fires.
 */
import { analyzeLog } from '@overfull/core';
import { listDirs, readText } from './repo';

export interface CorpusCase {
  id: string;
  rules: string[];
  title?: string;
  description?: string;
  engine?: string;
  tex: string;
  fixed?: string;
  log: string;
  excerpt: string;
}

function asStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Picks the rule ids a case.json proves, whatever shape it uses. */
function rulesOf(meta: Record<string, unknown>, id: string): string[] {
  const out = new Set<string>([...asStrings(meta.rule), ...asStrings(meta.rules)]);
  const expect = meta.expect ?? meta.expected ?? meta.problems;
  if (Array.isArray(expect)) {
    for (const e of expect) {
      if (typeof e === 'string') out.add(e);
      else if (e && typeof e === 'object' && typeof (e as { rule?: unknown }).rule === 'string')
        out.add((e as { rule: string }).rule);
    }
  } else if (expect && typeof expect === 'object') {
    for (const r of asStrings((expect as Record<string, unknown>).rules)) out.add(r);
    const rr = (expect as Record<string, unknown>).rule;
    if (typeof rr === 'string') out.add(rr);
  }
  if (out.size === 0) out.add(id);
  return [...out];
}

/** Lines of a log around the first line mentioning `needle`, trimmed for display. */
function logExcerpt(log: string, rules: string[]): string {
  const lines = log.split(/\r?\n/);
  try {
    const { build, output } = analyzeLog(log);
    const hit = [...build.problems, ...output.problems].find(
      (p) => rules.includes(p.rule) && p.evidence,
    );
    if (hit?.evidence) {
      const ev = hit.evidence.trim().split(/\r?\n/);
      if (ev.length <= 14) return ev.join('\n');
      return [...ev.slice(0, 12), '…'].join('\n');
    }
  } catch {
    // fall through to the heuristic
  }
  let i = lines.findIndex((l) => l.startsWith('!') || /:\d+: /.test(l));
  if (i < 0) i = lines.findIndex((l) => /Warning|Overfull|Underfull|not found|undefined/i.test(l));
  if (i < 0) return lines.slice(-12).join('\n');
  return lines
    .slice(Math.max(0, i - 1), i + 9)
    .join('\n')
    .trimEnd();
}

let cache: CorpusCase[] | null = null;

function corpusCases(): CorpusCase[] {
  if (cache) return cache;
  const cases: CorpusCase[] = [];
  for (const id of listDirs('corpus')) {
    const json = readText(`corpus/${id}/case.json`);
    const tex = readText(`corpus/${id}/main.tex`);
    const log = readText(`corpus/${id}/main.log`);
    if (!json || !tex || !log) continue;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const rules = rulesOf(meta, id);
    const fixedInline = [meta.fixed, meta.fixedTex, meta.fix_tex].find(
      (x): x is string => typeof x === 'string' && x.includes('\\'),
    );
    const fixed = readText(`corpus/${id}/fixed.tex`) ?? fixedInline ?? undefined;
    cases.push({
      id,
      rules,
      title: typeof meta.title === 'string' ? meta.title : undefined,
      description: typeof meta.description === 'string' ? meta.description : undefined,
      engine: typeof meta.engine === 'string' ? meta.engine : undefined,
      tex,
      fixed,
      log,
      excerpt: logExcerpt(log, rules),
    });
  }
  cache = cases;
  return cases;
}

export function caseForRule(ruleId: string, corpusId?: string): CorpusCase | undefined {
  const all = corpusCases();
  return (
    (corpusId ? all.find((c) => c.id === corpusId) : undefined) ??
    all.find((c) => c.rules.includes(ruleId)) ??
    all.find((c) => c.id === ruleId)
  );
}

/**
 * The message TeX itself prints for a rule, taken from the corpus log and made
 * generic (file names, line numbers and sizes elided), e.g. `Missing $ inserted`
 * or `LaTeX Error: File `…' not found`. This is what people paste into a search
 * engine, so rule pages lead with it. Undefined when the log has no clear line.
 */
export function texMessage(kase: CorpusCase | undefined, ruleId: string): string | undefined {
  if (!kase) return undefined;
  let line: string | undefined;
  try {
    const { build, output } = analyzeLog(kase.log);
    const hit = [...build.problems, ...output.problems].find((p) => p.rule === ruleId);
    line = hit?.evidence
      ?.split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
  if (!line) return undefined;
  const msg = line
    .replace(/^!\s*/, '')
    .replace(/`[^']*'|'[^']*'/g, (q) => (q.startsWith('`') ? "`…'" : "'…'"))
    .replace(/\S \(U\+[0-9A-F]+\)/g, '… (U+…)')
    .replace(/ in font \[.*$/, '')
    .replace(/, to which .*$/, '')
    .replace(/ \[[^\]]*\]/g, '')
    .replace(/\(\d+(\.\d+)?pt too (wide|high)\)/, '(…pt too $2)')
    .replace(/ in paragraph at lines .*$/, '')
    .replace(/ on page \d+/g, '')
    .replace(/ on input line \d+/g, '')
    .replace(/[.:]\s*$/, '')
    .trim();
  if (!msg || /^Package \w+ (Error|Warning)$/.test(msg) || msg.length > 90) return undefined;
  return msg;
}
