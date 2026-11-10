import type { PdfFacts } from '../pdf/types.js';
import type { CheckId } from '../types.js';

export type Level = 'required' | 'recommended' | 'off';

export interface VenueProfile {
  id: string;
  name: string;
  description: string;
  /**
   * Page limit; `endLabel` counts pages up to the page of `\label{endLabel}`.
   * `counts` and `excludes` describe in words what the venue counts (documentation only).
   */
  pageLimit?: { max: number; endLabel?: string; counts?: string; excludes?: string[] };
  paper?: 'a4' | 'letter' | 'any';
  anonymous?: boolean;
  disclosure?: Level;
  accessibility?: Level;
  arxiv?: boolean;
  /** Checks this profile runs by default. */
  checks?: CheckId[];
  /** Venue year, or `rolling` for venues without a yearly call. Set by profiles from `venues/`. */
  year?: number | 'rolling';
  /** Official pages the rules were read from. Set by profiles from `venues/`. */
  source?: string[];
  /** Date (YYYY-MM-DD) the rules were last compared with the official pages. */
  checkedOn?: string;
  /** Style or class files the venue requires, with the SHA-256 of the official copy when known. */
  styleFiles?: StyleFile[];
  /**
   * The venue's text block, in mm, from the official style file. Text printed outside it
   * (with 2 mm of tolerance) is `text-outside-block`. Without `leftMm` the block is taken as
   * centred horizontally; without `topMm` (or `heightMm`) only the width is checked.
   */
  textBlock?: TextBlock;
  /** Free-text notes shown in the docs. */
  notes?: string;
}

export interface TextBlock {
  widthMm: number;
  heightMm?: number;
  leftMm?: number;
  topMm?: number;
}

export interface StyleFile {
  /** File name as it appears in the project, e.g. `neurips_2027.sty`. */
  name: string;
  /** Lower-case hex SHA-256 of the official file, if known. */
  sha256?: string;
}

/**
 * A venue profile as stored in `venues.generated.ts`: the fields of `venues/<id>.yml`.
 * `extends` names a built-in profile (default `generic`) that supplies the other defaults.
 */
export type VenueProfileData = Partial<VenueProfile> & {
  id: string;
  name: string;
  extends?: string;
};

export type InlineProfile = Partial<VenueProfile> & { extends?: string };

export interface TexFile {
  /** Project-relative path, forward slashes. */
  path: string;
  content: string;
}

export interface VenueContext {
  facts?: PdfFacts;
  /** Concatenated .aux content (main aux plus included chapter aux files). */
  aux?: string;
  texFiles?: TexFile[];
  /** Build log text, used to detect the engine. */
  log?: string;
  /** Project-relative file list (for arXiv packaging checks). */
  files?: string[];
  /** Project-relative path of the main .tex file. */
  main?: string;
  /** "Now" for the profile-age note; defaults to the current date. Injectable for tests. */
  now?: Date;
}
