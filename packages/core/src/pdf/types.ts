/**
 * Facts extracted from a PDF. Produced by `extractPdfFacts` (pdf.js) and,
 * for fonts, by the CLI from `pdffonts`. Everything downstream (output,
 * accessibility and venue checks) reads only these facts.
 */

export interface PdfPage {
  /** 1-based page number. */
  number: number;
  /** Page text, items joined in content order, lines separated by `\n`. */
  text: string;
  widthMm: number;
  heightMm: number;
}

export interface PdfFigure {
  page: number;
  /** Alt text (`/Alt`, or `/ActualText` as fallback) when present. */
  alt?: string;
}

export interface PdfFont {
  name: string;
  type: string;
  embedded: boolean;
  subset: boolean;
  unicode: boolean;
}

export interface PdfInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  pdfVersion?: string;
}

export interface PdfXmp {
  title?: string;
  language?: string;
  creators?: string[];
  /** `pdfuaid:part` (1 or 2) when the file claims PDF/UA. */
  pdfuaPart?: number;
}

export interface PdfFacts {
  pageCount: number;
  pages: PdfPage[];
  info: PdfInfo;
  xmp: PdfXmp;
  /** Catalog `/Lang`, falling back to XMP `dc:language`. */
  language?: string;
  /** Info `/Title`, falling back to XMP `dc:title`. */
  title?: string;
  /** `/MarkInfo /Marked true`. */
  tagged: boolean;
  /** True when at least one page has a structure tree. */
  hasStructTree: boolean;
  /** `/ViewerPreferences /DisplayDocTitle`; undefined when unknown. */
  displayDocTitle?: boolean;
  figures: PdfFigure[];
  /** Filled by the CLI from `pdffonts`; absent when not measured. */
  fonts?: PdfFont[];
  /** PDF/UA part claimed in XMP, if any. */
  pdfua?: number;
}

/** The subset of the pdf.js API Overfull uses. Inject `pdfjs-dist` (or the legacy build). */
export interface PdfjsLike {
  getDocument(src: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfjsDocument>; destroy?(): Promise<void> };
}

export interface PdfjsDocument {
  numPages: number;
  getMetadata(): Promise<{ info: object; metadata: PdfjsMetadata | null }>;
  getMarkInfo(): Promise<unknown>;
  getViewerPreferences?(): Promise<unknown>;
  getPage(n: number): Promise<PdfjsPage>;
  destroy?(): Promise<void>;
}

export interface PdfjsMetadata {
  get(name: string): unknown;
}

export interface PdfjsPage {
  view: number[];
  rotate?: number;
  getTextContent(): Promise<{ items: unknown[] }>;
  getStructTree(): Promise<PdfjsStructNode | null>;
  cleanup?(): unknown;
}

export interface PdfjsStructNode {
  role?: string;
  alt?: string;
  children?: unknown[];
}

export interface VeraPdfFailure {
  specification: string;
  clause: string;
  testNumber?: number;
  description: string;
  failedChecks: number;
  /** A few failing object contexts, for evidence. */
  contexts: string[];
  /** 1-based pages named by the failing contexts (`pages[31]` → 32), sorted, unique. */
  pages?: number[];
}

export interface VeraPdfResult {
  compliant: boolean;
  profile?: string;
  statement?: string;
  passedRules?: number;
  failedRules?: number;
  failedChecks?: number;
  failures: VeraPdfFailure[];
  /** Set when veraPDF could not validate the file (parse error, crash). */
  error?: string;
}

export type CheckLevel = 'required' | 'recommended' | 'off';
