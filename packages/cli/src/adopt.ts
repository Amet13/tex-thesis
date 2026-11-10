import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { profilesForStyleFile } from '@overfull/core';
import { DEFAULT_IMAGE, latexmkrcDirs } from './config.js';
import { UsageError } from './io.js';
import { ambiguousMainError, detectMain, listFiles, MAX_TEX_BYTES } from './project.js';
import { insideRootForWrite, safeJobname, safeRelPath } from './safety.js';
import { agentKit } from './templates.js';

export type TexEngine = 'pdflatex' | 'lualatex' | 'xelatex';
export type BibBackend = 'biber' | 'bibtex' | 'none';

/** What `overfull init --here` found, each with a note on how it was found. */
export interface Detected {
  main: string;
  mainHow: string;
  jobname: string;
  jobnameHow: string;
  engine: TexEngine;
  engineHow: string;
  /** True when .latexmkrc names the engine (latexmk then needs no engine flag). */
  engineFromLatexmkrc: boolean;
  bib: string[];
  bibHow: string;
  backend: BibBackend;
  backendHow: string;
  documentClass: string | null;
  profile: string;
  profileHow: string;
  /** Style and class files that were looked up in the venue data. */
  styleFiles: string[];
}

/** Maps a latexmk/TeX engine word to an engine; undefined for anything else (`latex`, `tex`). */
function engineWord(word: string): TexEngine | undefined {
  const w = word.toLowerCase();
  if (w === 'pdflatex' || w === 'pdftex') return 'pdflatex';
  if (w === 'lualatex' || w === 'luatex') return 'lualatex';
  if (w === 'xelatex' || w === 'xetex') return 'xelatex';
  return undefined;
}

/** Engine named in a `.latexmkrc` / `latexmkrc`, with the line that named it. */
function engineFromLatexmkrc(root: string): { engine: TexEngine; how: string } | undefined {
  for (const name of ['.latexmkrc', 'latexmkrc']) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8').replace(/(^|[^\\$])#.*$/gm, '$1');
    const mode = /\$pdf_mode\s*=\s*(\d)/.exec(text)?.[1];
    const prog = /\$pdflatex\s*=\s*['"]([^'"]*)['"]/.exec(text)?.[1] ?? '';
    const named = /lualatex/.test(prog) ? 'lualatex' : /xelatex/.test(prog) ? 'xelatex' : undefined;
    if (mode === '4') return { engine: 'lualatex', how: `\`$pdf_mode = 4\` in ${name}` };
    if (mode === '5') return { engine: 'xelatex', how: `\`$pdf_mode = 5\` in ${name}` };
    if (named) return { engine: named, how: `\`$pdflatex\` runs ${named} in ${name}` };
    if (mode === '1') return { engine: 'pdflatex', how: `\`$pdf_mode = 1\` in ${name}` };
    return undefined;
  }
  return undefined;
}

/** All project .tex files, comments removed, with their paths. */
function readSources(root: string): { path: string; raw: string; text: string }[] {
  const out: { path: string; raw: string; text: string }[] = [];
  for (const path of listFiles(root)) {
    if (!/\.tex$/i.test(path)) continue;
    try {
      const abs = join(root, path);
      if (statSync(abs).size > MAX_TEX_BYTES) continue;
      const raw = readFileSync(abs, 'utf8');
      out.push({ path, raw, text: raw.replace(/(^|[^\\])%.*$/gm, '$1') });
    } catch {
      /* unreadable: ignored */
    }
    if (out.length >= 400) break;
  }
  return out;
}

const THESIS_CLASSES = new Set(['report', 'book', 'memoir', 'scrreprt', 'scrbook']);

export interface DetectOptions {
  /** `--main`: use this file instead of detecting one. */
  main?: string;
  /** Venue lookup for a style file name; tests inject one. Default: the built-in venue data. */
  styleLookup?: (fileName: string) => string[];
}

/** Reads the project in `root` and returns what overfull.yml will say. Never writes. */
export function detectProject(root: string, opts: DetectOptions = {}): Detected {
  const rc = latexmkrcDirs(root);
  // main file
  let main: string;
  let mainHow: string;
  if (opts.main !== undefined) {
    main = safeRelPath(opts.main);
    if (!existsSync(join(root, main))) throw new UsageError(`Main file not found: ${opts.main}`);
    mainHow = 'given with --main';
  } else {
    const found = detectMain(root, [
      ...new Set(['.', rc.outDir ?? '.', rc.auxDir ?? rc.outDir ?? '.']),
    ]);
    if (found.main) {
      main = found.main;
      mainHow =
        found.how === 'main.tex'
          ? 'the file is named main.tex'
          : found.how === 'matching build output'
            ? 'the only .tex file with \\documentclass that has a matching .log or .pdf'
            : 'the only .tex file here with \\documentclass';
    } else if (found.candidates.length > 1) {
      throw ambiguousMainError(found.candidates);
    } else {
      throw new UsageError(
        'No .tex file with \\documentclass found in this folder. Run this in the folder of your LaTeX project, or name the file with `--main path/to/main.tex`.',
      );
    }
  }

  const sources = readSources(root);
  const all = sources.map((s) => s.text).join('\n');
  const rawAll = sources.map((s) => s.raw).join('\n');
  const mainSrc = sources.find((s) => s.path === main);

  // jobname
  const jobname = safeJobname(rc.jobname ?? (main.split('/').pop() ?? main).replace(/\.tex$/i, ''));
  const jobnameHow = rc.jobname
    ? '`$jobname` in .latexmkrc'
    : 'the main file name, which is what latexmk uses';

  // engine
  let engine: TexEngine = 'pdflatex';
  let engineHow = 'no engine setting found: pdfLaTeX is the LaTeX default';
  let fromRc = false;
  const viaRc = engineFromLatexmkrc(root);
  const magic = /^\s*%\s*!T[eE]X\s+(?:TS-)?program\s*=\s*([A-Za-z]+)/m.exec(
    mainSrc?.raw ?? rawAll,
  )?.[1];
  const magicEngine = magic ? engineWord(magic) : undefined;
  if (viaRc) {
    engine = viaRc.engine;
    engineHow = viaRc.how;
    fromRc = true;
  } else if (magicEngine) {
    engine = magicEngine;
    engineHow = `\`% !TEX program = ${magic}\` line`;
  } else if (
    /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:fontspec|unicode-math)\b/.test(all)
  ) {
    // fontspec and unicode-math run only on LuaLaTeX or XeLaTeX.
    const xe = /\\XeTeX|\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:xeCJK|xltxtra|xunicode)\b/.test(all);
    engine = xe ? 'xelatex' : 'lualatex';
    engineHow = xe
      ? 'fontspec or unicode-math is loaded together with XeTeX-only commands'
      : 'fontspec or unicode-math is loaded, which needs LuaLaTeX or XeLaTeX';
  } else if (/\\DocumentMetadata\b/.test(all) && /\\directlua|luacode|luatex|lualatex/i.test(all)) {
    engine = 'lualatex';
    engineHow = '\\DocumentMetadata is used together with LuaTeX commands';
  }

  // document class and packages
  const documentClass =
    /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/.exec(mainSrc?.text ?? all)?.[1]?.trim() ?? null;
  const packages: string[] = [];
  for (const m of all.matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/g))
    for (const p of (m[1] as string).split(',')) packages.push(p.trim());

  // bibliography
  const mainDir = dirname(main);
  const found: string[] = [];
  const how: string[] = [];
  for (const s of sources) {
    for (const m of s.text.matchAll(/\\addbibresource(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
      found.push((m[1] as string).trim());
      how.push(`\\addbibresource in ${s.path}`);
    }
    for (const m of s.text.matchAll(/\\bibliography\{([^}]+)\}/g)) {
      for (const b of (m[1] as string).split(',')) {
        const name = b.trim();
        if (!name) continue;
        found.push(name.endsWith('.bib') ? name : `${name}.bib`);
        how.push(`\\bibliography in ${s.path}`);
      }
    }
  }
  const bib: string[] = [];
  const bibWhere = new Set<string>();
  found.forEach((f, i) => {
    if (/^[a-z]+:\/\//i.test(f) || f.startsWith('/') || f.split(/[\\/]/).includes('..')) return;
    const p = mainDir === '.' ? f : join(mainDir, f).split('\\').join('/');
    if (!bib.includes(p)) bib.push(p);
    bibWhere.add(how[i] as string);
  });
  let bibHow = `${[...bibWhere].join(', ')}`;
  if (bib.length === 0) {
    const root_bibs = readdirSync(root)
      .filter((f) => f.endsWith('.bib'))
      .sort();
    bib.push(...root_bibs);
    bibHow = root_bibs.length
      ? 'no \\bibliography or \\addbibresource found; every .bib file in this folder'
      : 'no \\bibliography, \\addbibresource or .bib file found';
  }

  // backend
  const biblatex = /\\(?:usepackage|RequirePackage)(?:\[([^\]]*)\])?\{[^}]*\bbiblatex\b/.exec(all);
  let backend: BibBackend;
  let backendHow: string;
  if (biblatex) {
    const viaBibtex = /backend\s*=\s*bibtex/i.test(biblatex[1] ?? '');
    backend = viaBibtex ? 'bibtex' : 'biber';
    backendHow = viaBibtex
      ? 'biblatex is loaded with backend=bibtex'
      : 'biblatex is loaded without backend=bibtex';
  } else if (bib.length > 0 || /\\bibliographystyle\b/.test(all)) {
    backend = 'bibtex';
    backendHow = 'no biblatex; \\bibliography with BibTeX';
  } else {
    backend = 'none';
    backendHow = 'no bibliography found';
  }

  // venue profile
  const lookup = opts.styleLookup ?? profilesForStyleFile;
  const names = new Set<string>();
  for (const f of listFiles(root)) if (/\.(sty|cls|bst)$/i.test(f)) names.add(f);
  for (const p of packages) names.add(`${p}.sty`);
  if (documentClass) names.add(`${documentClass}.cls`);
  const styleFiles = [...names].sort();
  const profiles = new Set<string>();
  for (const n of styleFiles) for (const id of lookup(n)) profiles.add(id);
  const hasChapters = /\\chapter\b/.test(all);
  let profile: string;
  let profileHow: string;
  if (profiles.size === 1) {
    profile = [...profiles][0] as string;
    profileHow = `the project uses a style file of the "${profile}" venue`;
  } else if (profiles.size > 1) {
    profile = 'generic';
    profileHow = `style files match several venues (${[...profiles].sort().join(', ')}): choose one`;
  } else if (
    documentClass &&
    ((THESIS_CLASSES.has(documentClass) && hasChapters) ||
      /thesis|dissertation/i.test(documentClass))
  ) {
    profile = 'thesis';
    profileHow = `no known venue style file; class "${documentClass}" with chapters looks like a thesis`;
  } else {
    profile = 'generic';
    profileHow = 'no known venue style file found, so no venue rules are assumed';
  }

  return {
    main,
    mainHow,
    jobname,
    jobnameHow,
    engine,
    engineHow,
    engineFromLatexmkrc: fromRc,
    bib,
    bibHow,
    backend,
    backendHow,
    documentClass,
    profile,
    profileHow,
    styleFiles: styleFiles.filter((n) => lookup(n).length > 0),
  };
}

const plain = (s: string) => (/^[A-Za-z0-9._/-]+$/.test(s) ? s : JSON.stringify(s));

const ENGINE_FLAG: Record<TexEngine, string> = {
  pdflatex: '-pdf',
  lualatex: '-lualatex',
  xelatex: '-xelatex',
};

/** latexmk arguments that build the project with the detected engine. */
export function latexmkCommand(d: Detected): string {
  return [
    'latexmk',
    ...(d.engineFromLatexmkrc ? [] : [ENGINE_FLAG[d.engine]]),
    '-interaction=nonstopmode',
    '-file-line-error',
    `-jobname=${d.jobname}`,
    d.main,
  ].join(' ');
}

/** The text of overfull.yml: every value with a comment on how it was found. */
export function renderConfig(d: Detected): string {
  const bib = d.bib.length ? `[${d.bib.map(plain).join(', ')}]` : '[]';
  return `# overfull.yml: written by \`overfull init --here\` from what is in this folder.
# Each value has a comment saying how it was found. Change what is wrong.
# Docs: https://amet13.github.io/overfull/

# Main file: ${d.mainHow}.
main: ${plain(d.main)}
# Job name (the output is <jobname>.pdf and <jobname>.log): ${d.jobnameHow}.
jobname: ${d.jobname}
# Bibliography files: ${d.bibHow}.
bib: ${bib}
# Venue profile: ${d.profileHow}.
# Heuristic, kept simple: a venue style file found in the venue data picks that
# venue; a report, book or memoir class with \\chapter picks "thesis"; anything
# else is "generic". Run \`overfull explain --list\` and see the Venues page to change it.
profile: ${d.profile}
# Checks to run: all of them. Remove one to skip it.
checks: [build, output, references, accessibility, venue]
references:
  # Your e-mail lets CrossRef and OpenAlex put you in their faster "polite pool".
  # mailto: you@example.org
  ignore: []
  # Off here: the entries in your .bib file were not written by \`overfull cite\`,
  # so none carries its proof. Overfull still looks every entry up in the indexes.
  # Turn it on (true) once the bibliography grows only through \`overfull cite\`, or
  # when an AI agent works on this project: then an entry that no index verifies
  # and that \`cite\` did not write is reported as reference-unproven.
  requireCite: false
# No venue rules are set. For a page limit, add for example:
# venue:
#   pageLimit: { max: 8 }
build:
  engine: auto             # local latexmk if installed, otherwise Docker
  image: ${DEFAULT_IMAGE}  # the Overfull Docker image used when latexmk is not installed

# Found, and not settings (latexmk reads these from your project itself):
#   TeX engine: ${d.engine}, from ${d.engineHow}.
#   Bibliography backend: ${d.backend}, because ${d.backendHow}.
#   Document class: ${d.documentClass ?? 'not found'}, from \\documentclass in the main file.
`;
}

/** A `.latexmkrc` that selects the engine, written only when none exists and the engine is not LuaLaTeX. */
function renderLatexmkrc(d: Detected): string {
  return `# latexmk configuration written by \`overfull init --here\`.
# \`overfull build\` builds with LuaLaTeX when a project has no .latexmkrc; this file
# keeps ${d.engine}, which was found from: ${d.engineHow}.
$pdf_mode = ${d.engine === 'xelatex' ? 5 : 1};   # 1 = pdflatex, 4 = lualatex, 5 = xelatex
`;
}

/** The Makefile: modelled on the templates' Makefile, with the detected engine. */
export function renderMakefile(d: Detected): string {
  const T = '\t';
  return `# Makefile: shortcuts for building and checking the document.
# Written by \`overfull init --here\`. Uses the \`overfull\` CLI when it is installed;
# otherwise everything runs in the Overfull Docker image, so the only requirement is Docker.
#   make build                          build the PDF (${d.engine})
#   make build IMAGE=overfull-tex:dev   use another image
# Run \`make help\` for all targets.

JOB    ?= $(shell sed -n 's/^jobname: *\\([^ #]*\\).*/\\1/p' overfull.yml)
IMAGE  ?= $(or $(OVERFULL_IMAGE),${DEFAULT_IMAGE})
BASE   ?= origin/main
PAGES  ?= 1-3
# Engine flags are left out when .latexmkrc names the engine.
LATEXMK_FLAGS ?= ${[...(d.engineFromLatexmkrc ? [] : [ENGINE_FLAG[d.engine]]), '-interaction=nonstopmode', '-file-line-error'].join(' ')}
MAIN   ?= ${d.main}

OVERFULL := $(shell command -v overfull 2>/dev/null)
# Run as your own user so build files are not owned by root.
DOCKER   := docker run --rm -t -u "$(shell id -u):$(shell id -g)" -e HOME=/tmp \\
            -v "$(CURDIR):/work" -w /work $(IMAGE)

ifdef OVERFULL
  RUN_OVERFULL = overfull
else
  RUN_OVERFULL = $(DOCKER) overfull
endif

# latexmk directly: works with any TeX Live image, even without the CLI.
ifneq ($(shell command -v latexmk 2>/dev/null),)
  RUN_LATEXMK = latexmk
else
  RUN_LATEXMK = $(DOCKER) latexmk
endif

.DEFAULT_GOAL := help
.PHONY: help build watch check pages diff clean

help: ## Show this help
${T}@awk 'BEGIN{FS=":.*## "} /^[a-z-]+:.*## /{printf "  make %-8s %s\\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the PDF with latexmk (no overfull CLI needed)
${T}$(RUN_LATEXMK) $(LATEXMK_FLAGS) -jobname=$(JOB) $(MAIN)

watch: ## Rebuild the PDF on every save
${T}$(RUN_LATEXMK) $(LATEXMK_FLAGS) -jobname=$(JOB) -pvc -view=none $(MAIN)

check: ## Preflight: build log, PDF, references, accessibility
${T}$(RUN_OVERFULL) check

pages: ## Render pages to PNG for review, e.g. make pages PAGES=4-6
${T}$(RUN_OVERFULL) pages $(PAGES)

diff: ## PDF with changes against BASE (default origin/main)
${T}$(RUN_OVERFULL) diff --base $(BASE)

clean: ## Remove build files (keeps the PDF)
${T}$(RUN_LATEXMK) -c -jobname=$(JOB) $(MAIN)
`;
}

/** Lines to add to a Makefile that already exists. */
export function makefileSnippet(d: Detected): string {
  const T = '\t';
  return `.PHONY: preflight
preflight: ## Overfull: build log, PDF, references, accessibility
${T}overfull check

# Build with the engine Overfull detected (${d.engine}):
#   ${latexmkCommand(d)}
`;
}

/** The GitHub Actions workflow: modelled on templates/paper/.github/workflows/paper.yml. */
export function renderWorkflow(d: Detected): string {
  const build = latexmkCommand(d);
  return `# Build the PDF in the Overfull image, run the preflight and publish results.
# Written by \`overfull init --here\`. Engine: ${d.engine} (${d.engineHow}).
# Push: PDF artifact + job summary. Pull request: also a PDF of the changes.
# Uses the image ${DEFAULT_IMAGE}, published with Overfull v3.0.0.
name: overfull

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    container:
      image: ${DEFAULT_IMAGE}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0 # full history for \`overfull diff\`
          persist-credentials: false

      # The job runs as root in the image while the checkout belongs to the
      # runner user: let git (used by \`overfull diff\`) trust this one directory.
      - name: Trust the checkout
        run: git config --global --add safe.directory "$GITHUB_WORKSPACE"

      - name: Build
        run: ${build}

      # The first two runs only report (summary + inline annotations);
      # the last one sets the job status. Reference lookups are cached.
      - name: Preflight
        run: |
          overfull check --markdown >> "$GITHUB_STEP_SUMMARY" || true
          overfull check --annotations || true
          overfull check

      - name: Diff against base branch
        if: github.event_name == 'pull_request'
        env:
          BASE_REF: \${{ github.base_ref }}
        run: overfull diff --base "origin/$BASE_REF"

      - name: Upload PDF
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: pdf
          path: |
            *.pdf
            *.log
          if-no-files-found: warn
`;
}

export interface Parts {
  agents: boolean;
  ci: boolean;
  make: boolean;
}

export interface PlannedFile {
  path: string;
  content: string | Buffer;
  /** Why the file is part of the run (printed with it). */
  note: string;
  /** A Makefile is never overwritten, even with --force. */
  neverOverwrite?: boolean;
}

export interface Plan {
  files: PlannedFile[];
  /** `.claude/skills` -> `../.agents/skills`, when the agent kit is included. */
  link?: { path: string; target: string; copyFrom: string };
}

/** The files this run would write. Paths are relative to the project root. */
export function planAdopt(d: Detected, parts: Parts, root: string): Plan {
  const files: PlannedFile[] = [
    { path: 'overfull.yml', content: renderConfig(d), note: 'detected settings' },
  ];
  const hasRc = ['.latexmkrc', 'latexmkrc'].some((n) => existsSync(join(root, n)));
  if (!hasRc && d.engine !== 'lualatex') {
    files.push({
      path: '.latexmkrc',
      content: renderLatexmkrc(d),
      note: `keeps ${d.engine} (without a .latexmkrc, \`overfull build\` uses LuaLaTeX)`,
    });
  }
  let link: Plan['link'];
  if (parts.agents) {
    const kit = agentKit();
    if (!kit)
      throw new UsageError(
        'The agent files are not bundled with this overfull install (no template found). Reinstall overfull.',
      );
    for (const f of kit) files.push({ path: f.path, content: f.content, note: 'agent files' });
    link = { path: '.claude/skills', target: '../.agents/skills', copyFrom: '.agents/skills' };
  }
  if (parts.ci)
    files.push({
      path: '.github/workflows/overfull.yml',
      content: renderWorkflow(d),
      note: 'CI workflow',
    });
  if (parts.make)
    files.push({
      path: 'Makefile',
      content: renderMakefile(d),
      note: 'build and check targets',
      neverOverwrite: true,
    });
  return { files, ...(link ? { link } : {}) };
}

export interface Written {
  path: string;
  note: string;
}
export interface Skipped {
  path: string;
  reason: string;
}

export interface AdoptResult {
  written: Written[];
  skipped: Skipped[];
  /** Lines to add to an existing Makefile. */
  makefileLines?: string;
}

function lstatOrUndefined(p: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
}

/**
 * Applies a plan under `root`. Nothing is overwritten without `force`, no file
 * is removed, every path is checked to stay inside the project before the
 * first write, and `dryRun` writes nothing (the result lists what would be written).
 */
export function applyPlan(
  root: string,
  plan: Plan,
  d: Detected,
  opts: { force: boolean; dryRun: boolean },
): AdoptResult {
  // Resolve every target first: one path that escapes the project stops the run before any write.
  const abs = new Map<string, string>();
  for (const f of plan.files) abs.set(f.path, insideRootForWrite(root, join(root, f.path), f.path));
  if (plan.link)
    abs.set(plan.link.path, insideRootForWrite(root, join(root, plan.link.path), plan.link.path));

  const result: AdoptResult = { written: [], skipped: [] };
  for (const f of plan.files) {
    const p = abs.get(f.path) as string;
    const st = lstatOrUndefined(p);
    if (st) {
      if (st.isSymbolicLink()) {
        result.skipped.push({ path: f.path, reason: 'is a symbolic link; left alone' });
        continue;
      }
      if (!st.isFile()) {
        result.skipped.push({ path: f.path, reason: 'exists and is not a regular file' });
        continue;
      }
      const same = readFileSync(p).equals(
        typeof f.content === 'string' ? Buffer.from(f.content) : f.content,
      );
      if (same) {
        result.skipped.push({ path: f.path, reason: 'already there, unchanged' });
        continue;
      }
      if (f.neverOverwrite) {
        result.skipped.push({ path: f.path, reason: 'exists; left untouched' });
        if (f.path === 'Makefile') result.makefileLines = makefileSnippet(d);
        continue;
      }
      if (!opts.force) {
        result.skipped.push({ path: f.path, reason: 'exists; use --force to overwrite' });
        continue;
      }
    }
    if (!opts.dryRun) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.content);
    }
    result.written.push({ path: f.path, note: st ? `${f.note} (overwritten)` : f.note });
  }

  if (plan.link) {
    const p = abs.get(plan.link.path) as string;
    const st = lstatOrUndefined(p);
    if (st?.isSymbolicLink() && readlinkSync(p) === plan.link.target) {
      result.skipped.push({ path: plan.link.path, reason: 'already there, unchanged' });
    } else if (st) {
      result.skipped.push({
        path: plan.link.path,
        reason: st.isSymbolicLink()
          ? 'is a link to somewhere else; left alone'
          : 'exists; left alone',
      });
    } else {
      if (!opts.dryRun) {
        mkdirSync(dirname(p), { recursive: true });
        try {
          symlinkSync(plan.link.target, p, 'dir');
        } catch {
          // No symlink rights (Windows without developer mode): copy, as `overfull init` does.
          cpSync(join(root, plan.link.copyFrom), p, { recursive: true });
        }
      }
      result.written.push({
        path: plan.link.path,
        note: `link to ${plan.link.target}, for Claude Code; a copy where links are not allowed`,
      });
    }
  }
  return result;
}
