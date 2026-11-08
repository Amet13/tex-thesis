import type { CheckId } from '../types.js';
import type { PdfFacts } from '../pdf/types.js';

export type Level = 'required' | 'recommended' | 'off';

export interface VenueProfile {
  id: string;
  name: string;
  description: string;
  /** Page limit; `endLabel` counts pages up to the page of `\label{endLabel}`. */
  pageLimit?: { max: number; endLabel?: string };
  paper?: 'a4' | 'letter' | 'any';
  anonymous?: boolean;
  disclosure?: Level;
  accessibility?: Level;
  arxiv?: boolean;
  /** Checks this profile runs by default. */
  checks?: CheckId[];
}

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
}
