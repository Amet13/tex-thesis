/**
 * Build-log analysis: `parseLog` extracts facts from a TeX log, `analyzeLog`
 * turns them into the `build` and `output` checks, `logRules` documents every
 * rule those checks can emit.
 */

export { type AnalyzeLogOptions, analyzeLog, type LogAnalysis } from './analyze.js';
export { normalizePath } from './paths.js';
export { type ParseOptions, parseLog } from './parse.js';
export { logRules } from './rules.js';
export type { LogError, LogOutputFile, LogWarning, LogWarningKind, ParsedLog } from './types.js';
