import { getRule } from '../rules.js';
import type { Problem, Report, Severity } from '../types.js';
import { oneLine, sortedProblems } from './shared.js';

/**
 * SARIF 2.1.0 for GitHub code scanning.
 *
 * GitHub's requirements (read 2026-11-10):
 * https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning
 * A result needs at least one location with a physicalLocation, a relative
 * artifactLocation.uri and a region.startLine, or code scanning does not show it.
 * So a problem without a file (PDF, venue and most reference findings) gets the
 * project's main file at line 1; with no file to fall back on it has no location
 * and GitHub will not display it.
 */

const SITE = 'https://amet13.github.io/overfull/';
const SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

export interface SarifOptions {
  /** Prefix for file paths: the project directory relative to the repository root. */
  root?: string;
  /** File for problems that have none (default: `report.assumed.main`, else no location). */
  fallbackFile?: string;
}

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

function joinPath(root: string | undefined, file: string): string {
  const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!root || root === '.' || root === './') return f;
  return `${root.replace(/\/+$/, '')}/${f}`;
}

function messageOf(p: Problem): string {
  const page = p.location?.page && !p.location.file ? `Page ${p.location.page}: ` : '';
  const text = `${page}${oneLine(p.message)}`;
  return p.fix ? `${text} Fix: ${oneLine(p.fix)}` : text;
}

function ruleDescriptor(id: string, problem: Problem) {
  const info = getRule(id);
  const title = info?.title ?? oneLine(problem.message);
  return {
    id,
    name: id,
    shortDescription: { text: title.slice(0, 1024) },
    ...(info ? { fullDescription: { text: info.summary } } : {}),
    ...(info?.fix ? { help: { text: info.fix } } : {}),
    helpUri: `${SITE}rules/${encodeURIComponent(id)}/`,
    defaultConfiguration: { level: LEVEL[info?.severity ?? problem.severity] },
    properties: { tags: [info?.check ?? problem.check] },
  };
}

/** A SARIF 2.1.0 log (one run) for the report, as a JSON string with a trailing newline. */
export function formatSarif(report: Report, opts: SarifOptions = {}): string {
  const problems = sortedProblems(report);
  const fallback = opts.fallbackFile ?? report.assumed?.main;
  const ids: string[] = [];
  const first = new Map<string, Problem>();
  for (const p of problems) {
    if (!first.has(p.rule)) {
      first.set(p.rule, p);
      ids.push(p.rule);
    }
  }
  const results = problems.map((p) => {
    const file = p.location?.file ?? fallback;
    const line = p.location?.file ? p.location.line : undefined;
    return {
      ruleId: p.rule,
      ruleIndex: ids.indexOf(p.rule),
      level: LEVEL[p.severity],
      message: { text: messageOf(p) },
      ...(file
        ? {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: joinPath(opts.root, file), uriBaseId: '%SRCROOT%' },
                  region: { startLine: line && line > 0 ? line : 1 },
                },
              },
            ],
          }
        : {}),
    };
  });
  const log = {
    $schema: SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'overfull',
            version: report.version,
            informationUri: SITE,
            rules: ids.map((id) => ruleDescriptor(id, first.get(id) as Problem)),
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
