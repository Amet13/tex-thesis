export { arxivCacheKey, doiCacheKey, titleCacheKey } from './cache.js';
export {
  bibIssueProblems,
  missingKeys,
  type RefsCheckOptions,
  refsCheck,
  refsRules,
} from './check.js';
export {
  entryFromRecord,
  generateKey,
  markCited,
  PROVENANCE_FIELD,
  provenanceOf,
} from './entry.js';
export { type EntryKind, entryKind, identifiersOf } from './kind.js';
export {
  AmbiguousLookupError,
  LOOKUP_MIN_CONFIDENCE,
  LOOKUP_TITLE_THRESHOLD,
  lookup,
  queryKind,
} from './lookup.js';
export { normalizeTitle, titleSimilarity } from './normalize.js';
export { parseArxivFeed, parseArxivId } from './sources/arxiv.js';
export { parseDoi } from './sources/doi.js';
export type {
  LookupCandidate,
  LookupHint,
  LookupResult,
  MatchedRecord,
  RefCache,
  RefDifference,
  RefResult,
  RefSource,
  RefStatus,
  RefsOptions,
  WorkRecord,
} from './types.js';
export { verifyEntries } from './verify.js';
