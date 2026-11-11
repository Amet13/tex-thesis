export { arxivCacheKey, doiCacheKey, titleCacheKey } from './cache.js';
export {
  bibIssueProblems,
  citeHint,
  missingKeys,
  type RefsCheckOptions,
  refsCheck,
  refsRules,
} from './check.js';
export {
  entryFromRecord,
  generateKey,
  isAuthorProvided,
  markCited,
  PROVENANCE_FIELD,
  provenanceCanonical,
  provenanceHash,
  provenanceOf,
  sanitizeTexValue,
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
export { findRetractions, retractionOf } from './retraction.js';
export { parseAclBib, parseAclId } from './sources/acl.js';
export { parseArxivFeed, parseArxivId } from './sources/arxiv.js';
export { parseDoi } from './sources/doi.js';
export { parsePmcid, parsePmid } from './sources/europepmc.js';
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
  RetractionNotice,
  WorkRecord,
} from './types.js';
export { hasValidProvenance, notFoundQuorum, verifyEntries } from './verify.js';
