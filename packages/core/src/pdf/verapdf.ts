import type { VeraPdfFailure, VeraPdfResult } from './types.js';

const MAX_CONTEXTS = 3;

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null ? [] : [v];
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    out[m[1] as string] = decodeXml(m[3] ?? m[4] ?? '');
  }
  return out;
}

function childText(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1] ?? '') : '';
}

/** Merges failures of the same clause (several test numbers) into one entry. */
function mergeByClause(failures: VeraPdfFailure[]): VeraPdfFailure[] {
  const byKey = new Map<string, VeraPdfFailure>();
  for (const f of failures) {
    const key = `${f.specification}|${f.clause}|${f.testNumber ?? ''}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.failedChecks += f.failedChecks;
      prev.contexts = [...prev.contexts, ...f.contexts].slice(0, MAX_CONTEXTS);
    } else byKey.set(key, { ...f });
  }
  return [...byKey.values()];
}

function parseXml(xml: string): VeraPdfResult {
  const vr = /<validationReport\b([^>]*)>([\s\S]*?)<\/validationReport>/.exec(xml);
  if (!vr) {
    const exception = childText(xml, 'exceptionMessage') || childText(xml, 'message');
    return {
      compliant: false,
      failures: [],
      error: exception || 'No <validationReport> element found in veraPDF output',
    };
  }
  const head = attrs(vr[1] ?? '');
  const body = vr[2] ?? '';
  const details = /<details\b([^>]*)>/.exec(body);
  const d = attrs(details?.[1] ?? '');
  const failures: VeraPdfFailure[] = [];
  const ruleRe = /<rule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rule>)/g;
  for (let m = ruleRe.exec(body); m; m = ruleRe.exec(body)) {
    const a = attrs(m[1] ?? '');
    if (a.status && a.status !== 'failed') continue;
    const inner = m[2] ?? '';
    const contexts: string[] = [];
    const checkRe = /<check\b[^>]*status="failed"[^>]*>([\s\S]*?)<\/check>/g;
    for (
      let c = checkRe.exec(inner);
      c && contexts.length < MAX_CONTEXTS;
      c = checkRe.exec(inner)
    ) {
      const ctx = childText(c[1] ?? '', 'context');
      if (ctx) contexts.push(ctx);
    }
    const failure: VeraPdfFailure = {
      specification: a.specification ?? '',
      clause: a.clause ?? '',
      description: childText(inner, 'description'),
      failedChecks: num(a.failedChecks) ?? Math.max(1, contexts.length),
      contexts,
    };
    const tn = num(a.testNumber);
    if (tn !== undefined) failure.testNumber = tn;
    failures.push(failure);
  }
  const compliantAttr = head.isCompliant ?? head.compliant;
  const result: VeraPdfResult = {
    compliant: compliantAttr === 'true' || (compliantAttr === undefined && failures.length === 0),
    failures: mergeByClause(failures),
  };
  if (head.profileName) result.profile = head.profileName;
  if (head.statement) result.statement = head.statement;
  const pr = num(d.passedRules);
  const fr = num(d.failedRules);
  const fc = num(d.failedChecks);
  if (pr !== undefined) result.passedRules = pr;
  if (fr !== undefined) result.failedRules = fr;
  if (fc !== undefined) result.failedChecks = fc;
  return result;
}

/** Finds the first validation result object in any of veraPDF's JSON shapes. */
function findValidation(root: unknown): Json | undefined {
  if (!isObj(root)) return undefined;
  const report = isObj(root.report) ? root.report : root;
  for (const job of asArray(report.jobs)) {
    if (!isObj(job)) continue;
    const vr = asArray(job.validationResult ?? job.validationReport)[0];
    if (isObj(vr)) return vr;
    if (isObj(job.taskException) || job.taskException) return { taskException: job.taskException };
  }
  if (isObj(report.validationResult)) return report.validationResult;
  if (isObj(report.details)) return report;
  return undefined;
}

function parseJson(data: unknown): VeraPdfResult {
  const vr = findValidation(data);
  if (!vr) return { compliant: false, failures: [], error: 'No validation result in veraPDF JSON' };
  if (vr.taskException) {
    const ex = vr.taskException;
    const msg = isObj(ex) ? text(ex.exceptionMessage) || text(ex.message) : String(ex);
    return { compliant: false, failures: [], error: msg || 'veraPDF could not validate the file' };
  }
  const details = isObj(vr.details) ? vr.details : {};
  const failures: VeraPdfFailure[] = [];
  for (const r of asArray(details.ruleSummaries ?? details.rules)) {
    if (!isObj(r)) continue;
    const status = text(r.ruleStatus || r.status).toLowerCase();
    if (status && status !== 'failed') continue;
    const contexts = asArray(r.checks)
      .filter(isObj)
      .filter((c) => text(c.status).toLowerCase() !== 'passed')
      .map((c) => text(c.context))
      .filter(Boolean)
      .slice(0, MAX_CONTEXTS);
    const failure: VeraPdfFailure = {
      specification: text(r.specification),
      clause: text(r.clause),
      description: text(r.description),
      failedChecks: num(r.failedChecks) ?? Math.max(1, contexts.length),
      contexts,
    };
    const tn = num(r.testNumber);
    if (tn !== undefined) failure.testNumber = tn;
    failures.push(failure);
  }
  const compliant =
    typeof vr.compliant === 'boolean'
      ? vr.compliant
      : typeof vr.isCompliant === 'boolean'
        ? vr.isCompliant
        : failures.length === 0;
  const result: VeraPdfResult = { compliant, failures: mergeByClause(failures) };
  const profile = text(vr.profileName);
  const statement = text(vr.statement);
  if (profile) result.profile = profile;
  if (statement) result.statement = statement;
  const pr = num(details.passedRules);
  const fr = num(details.failedRules);
  const fc = num(details.failedChecks);
  if (pr !== undefined) result.passedRules = pr;
  if (fr !== undefined) result.failedRules = fr;
  if (fc !== undefined) result.failedChecks = fc;
  return result;
}

/**
 * Parses a veraPDF validation report: XML (`--format xml`/`mrr`) or JSON
 * (`--format json`). Never throws; unreadable input yields `error`.
 */
export function parseVeraPdfReport(xmlOrJson: string): VeraPdfResult {
  const trimmed = xmlOrJson.replace(/^﻿/, '').trim();
  if (!trimmed) return { compliant: false, failures: [], error: 'veraPDF produced no output' };
  const jsonStart = trimmed.search(/^[{[]/m);
  if (!trimmed.startsWith('<') && jsonStart >= 0) {
    try {
      return parseJson(JSON.parse(trimmed.slice(jsonStart)));
    } catch {
      return { compliant: false, failures: [], error: 'veraPDF output is not valid JSON' };
    }
  }
  const xmlStart = trimmed.indexOf('<');
  if (xmlStart >= 0) return parseXml(trimmed.slice(xmlStart));
  return { compliant: false, failures: [], error: trimmed.split('\n')[0] ?? 'Unreadable output' };
}
