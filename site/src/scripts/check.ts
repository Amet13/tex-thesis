/**
 * The browser check. Everything runs here, in the page: files (also a project
 * .zip or a dropped folder, unpacked by ./zip) are read with the File API and
 * analysed by @overfull/core. The only network requests are
 * reference lookups (CrossRef and doi.org; arXiv and DBLP refuse browser
 * requests) when the user leaves "Verify references online" on. pdf.js is
 * loaded only when a PDF is checked.
 */
import {
  accessibilityCheck,
  analyzeLog,
  type BibEntry,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  citedKeys,
  extractPdfFacts,
  formatJson,
  formatMarkdown,
  missingKeys,
  type PdfFacts,
  type PdfjsLike,
  type Problem,
  parseBibWithIssues,
  pdfOutputProblems,
  type RefCache,
  type RefResult,
  type RefsOptions,
  type Report,
  refsCheck,
  reportStatus,
  resolveProfile,
  statusOf,
  VERSION,
  venueCheck,
  verifyEntries,
} from '@overfull/core';
import { esc, renderSheet } from '../lib/sheet';
import { chooseMain, type ProjectFile, projectKindOf, selectForMain } from './project';
import { readZip, selectPaths, ZIP_LIMITS, ZipError } from './zip';

type Kind = 'log' | 'bib' | 'aux' | 'pdf' | 'tex';

interface Loaded {
  name: string;
  kind: Kind;
  text?: string;
  data?: Uint8Array;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
function must<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`check page: missing ${sel}`);
  return el;
}

function kindOf(name: string, head: string): Kind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || head.startsWith('%PDF')) return 'pdf';
  if (n.endsWith('.bib')) return 'bib';
  if (n.endsWith('.aux') || n.endsWith('.bcf')) return 'aux';
  if (n.endsWith('.tex')) return 'tex';
  if (n.endsWith('.log') || n.endsWith('.txt') || /This is (Lua|pdf|Xe|e-)?(HB)?TeX/i.test(head))
    return 'log';
  if (/^\s*@\w+\s*[{(]/m.test(head)) return 'bib';
  return null;
}

/** In-memory lookup cache for the session (also kept in sessionStorage when allowed). */
function sessionCache(): RefCache {
  const KEY = 'overfull-refs-cache';
  let store: Record<string, unknown> = {};
  try {
    store = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    store = {};
  }
  return {
    get: (k) => store[k],
    set: (k, v) => {
      store[k] = v;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(store));
      } catch {
        /* quota or disabled storage: keep it in memory */
      }
    },
  };
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

export function initCheck(): void {
  const files: Loaded[] = [];
  const cache = sessionCache();
  const config = JSON.parse($('#check-config')?.textContent ?? '{}') as { rulesBase?: string };
  const samples = JSON.parse($('#samples-data')?.textContent ?? '[]') as {
    id: string;
    label: string;
    files: { name: string; text: string }[];
  }[];

  const form = must<HTMLFormElement>('#intake');
  const drop = must('#drop');
  const input = must<HTMLInputElement>('#file-input');
  const choose = must<HTMLButtonElement>('#choose');
  const list = must<HTMLUListElement>('#files');
  const filesWrap = must('#files-wrap');
  const runBtn = must<HTMLButtonElement>('#run');
  const stopBtn = must<HTMLButtonElement>('#stop');
  const online = must<HTMLInputElement>('#online');
  const profileSel = must<HTMLSelectElement>('#profile');
  const progress = must('#progress');
  const bar = must('#progress-bar');
  const barFill = must<HTMLElement>('#progress-bar span');
  const tools = must('#result-tools');
  const sheetView = must('#sheet-view');
  const agentView = must('#agent-view');
  const agentToggle = must<HTMLButtonElement>('#agent-toggle');
  const jsonOut = must('#json-out');
  const copyStatus = must('#copy-status');
  const notice = must('#notice');

  const folderInput = must<HTMLInputElement>('#folder-input');
  const chooseFolder = must<HTMLButtonElement>('#choose-folder');
  const mainPick = must('#main-pick');
  const mainSelect = must<HTMLSelectElement>('#main-select');

  let report: Report | null = null;
  /** The last unpacked project (.zip or folder), while its files are in use. */
  let project: { name: string; all: ProjectFile[]; main?: string } | null = null;
  /** Files the last drop or pick could not use; shown until the files change. */
  let skippedMsg = '';
  let controller: AbortController | null = null;
  let runId = 0;

  const say = (msg: string) => {
    progress.textContent = msg;
  };
  /** A message that stays until the next file change (unlike progress). */
  const note = (msg: string) => {
    notice.textContent = msg;
    notice.hidden = !msg;
  };
  const setBar = (fraction: number | null) => {
    bar.hidden = fraction === null;
    barFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  };

  function renderFiles() {
    list.innerHTML = files
      .map(
        (f, i) =>
          `<li><span class="kind">${f.kind}</span><span class="name">${esc(f.name)}</span><button type="button" data-remove="${i}" aria-label="Remove ${esc(f.name)}">remove</button></li>`,
      )
      .join('');
    filesWrap.hidden = files.length === 0;
    runBtn.disabled = files.length === 0;
  }

  function add(loaded: Loaded[]) {
    for (const f of loaded) {
      const same = files.findIndex((x) => x.name === f.name && x.kind === f.kind);
      if (same >= 0) files.splice(same, 1, f);
      else files.push(f);
    }
    renderFiles();
  }

  function clearSamples() {
    for (const b of samples.length
      ? document.querySelectorAll<HTMLButtonElement>('[data-sample]')
      : [])
      b.setAttribute('aria-pressed', 'false');
  }

  function resetProject() {
    project = null;
    mainPick.hidden = true;
  }

  /** Puts the files of the chosen main file into the list and runs the check. */
  function applyMain(main: string | undefined, intro: string) {
    if (!project) return;
    project.main = main;
    const chosen = selectForMain(project.all, main);
    files.length = 0;
    add(
      chosen.map((f) => ({
        name: f.path,
        kind: f.kind,
        ...(f.data ? { data: f.data } : { text: f.text ?? '' }),
      })),
    );
    const count = (k: string) => chosen.filter((f) => f.kind === k).length;
    const bibs = count('bib');
    const found = [
      main ? `main file ${main}` : 'no main .tex file with a \\documentclass',
      `${bibs} .bib file${bibs === 1 ? '' : 's'}`,
      count('log') ? 'a build log' : 'no build log',
      count('pdf') ? 'a PDF' : 'no PDF',
      count('aux') ? 'an .aux or .bcf file' : 'no .aux or .bcf file',
    ].join(', ');
    skippedMsg = [`${project.name}: ${found}.`, intro].filter(Boolean).join(' ');
    note(skippedMsg);
    if (chosen.length) void run();
    else say(`${project.name}: no .tex, .bib, .log, .aux, .bcf or .pdf files found.`);
  }

  /** Takes the files of a project, picks the main file (or asks) and runs. */
  function loadProject(name: string, all: ProjectFile[], notes: string[]) {
    files.length = 0;
    renderFiles();
    tools.hidden = true;
    clearSamples();
    project = { name, all };
    const choice = chooseMain(all);
    const intro = notes.join(' ');
    if (choice.candidates.length > 1) {
      mainSelect.innerHTML = [
        `<option value="">Choose the main file…</option>`,
        ...choice.candidates.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`),
      ].join('');
      mainSelect.value = choice.main ?? '';
      mainPick.hidden = false;
      if (choice.main) {
        applyMain(choice.main, intro);
      } else {
        skippedMsg = [
          `${name}: ${choice.candidates.length} files could be the main file. Choose one below.`,
          intro,
        ]
          .filter(Boolean)
          .join(' ');
        note(skippedMsg);
        say('Choose the main file to run the check.');
      }
      return;
    }
    mainPick.hidden = true;
    applyMain(choice.main, intro);
  }

  const skippedNotes = (list: { path: string; reason: string }[]) =>
    list.length
      ? [
          `Left out: ${list
            .slice(0, 5)
            .map((s) => `${s.path} (${s.reason})`)
            .join(', ')}${list.length > 5 ? `, and ${list.length - 5} more` : ''}.`,
        ]
      : [];

  /** Loose files dropped with (or after) a project, by extension; names are the paths. */
  async function readLoose(list: File[]): Promise<{ all: ProjectFile[]; skipped: string[] }> {
    const all: ProjectFile[] = [];
    const skipped: string[] = [];
    for (const file of list) {
      const kind = projectKindOf(file.name);
      if (!kind) {
        skipped.push(file.name);
        continue;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      all.push(
        kind === 'pdf'
          ? { path: file.name, kind, data }
          : { path: file.name, kind, text: new TextDecoder('utf-8').decode(data) },
      );
    }
    return { all, skipped };
  }

  const mergeFiles = (base: ProjectFile[], extra: ProjectFile[]) => [
    ...base.filter((f) => !extra.some((x) => x.path === f.path)),
    ...extra,
  ];

  async function readZipFile(file: File, others: File[]) {
    say(`Unpacking ${file.name} in your browser…`);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const zip = await readZip(buf, { filter: (p) => projectKindOf(p) !== null });
      const all: ProjectFile[] = [];
      for (const f of zip.files) {
        const kind = projectKindOf(f.path);
        if (!kind) continue;
        all.push(
          kind === 'pdf'
            ? { path: f.path, kind, data: f.data }
            : { path: f.path, kind, text: new TextDecoder('utf-8').decode(f.data) },
        );
      }
      const loose = await readLoose(others);
      const notes = [
        ...skippedNotes(zip.skipped),
        ...(loose.skipped.length
          ? [
              `Skipped ${loose.skipped.join(', ')}: not a .log, .bib, .aux, .bcf, .tex or .pdf file.`,
            ]
          : []),
      ];
      loadProject(file.name, mergeFiles(all, loose.all), notes);
    } catch (err) {
      const msg =
        err instanceof ZipError
          ? err.message
          : `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
      skippedMsg = msg;
      note(msg);
      say(msg);
    }
  }

  /** A folder: files with a path relative to the folder's parent. */
  async function readFolder(items: { path: string; file: File }[], fallbackName: string) {
    say('Reading the folder in your browser…');
    try {
      const sel = selectPaths(items.map((i) => i.path));
      if (sel.kept.length + sel.skipped.length > ZIP_LIMITS.maxEntries)
        throw new Error(
          `This folder has ${sel.kept.length} files; the limit is ${ZIP_LIMITS.maxEntries}. Choose the project’s source folder only.`,
        );
      const total = sel.kept.reduce((n, k) => n + (items[k.index]?.file.size ?? 0), 0);
      if (total > ZIP_LIMITS.maxTotalBytes)
        throw new Error(
          `This folder is ${Math.ceil(total / 1048576)} MB; the limit is ${Math.round(ZIP_LIMITS.maxTotalBytes / 1048576)} MB. Choose the project’s source folder only.`,
        );
      const skipped = [...sel.skipped];
      const all: ProjectFile[] = [];
      for (const k of sel.kept) {
        const kind = projectKindOf(k.path);
        const file = items[k.index]?.file;
        if (!kind || !file) continue;
        if (file.size > ZIP_LIMITS.maxEntryBytes) {
          skipped.push({ path: k.path, reason: 'file is too large' });
          continue;
        }
        const data = new Uint8Array(await file.arrayBuffer());
        all.push(
          kind === 'pdf'
            ? { path: k.path, kind, data }
            : { path: k.path, kind, text: new TextDecoder('utf-8').decode(data) },
        );
      }
      const root = items[0]?.path.split('/')[0];
      loadProject(
        items.every((i) => i.path.split('/')[0] === root) && root ? root : fallbackName,
        all,
        skippedNotes(skipped),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skippedMsg = msg;
      note(msg);
      say(msg);
    }
  }

  /** Walks dropped file-system entries (needs webkitGetAsEntry). */
  async function readDropped(entries: FileSystemEntry[]) {
    const out: { path: string; file: File }[] = [];
    let seen = 0;
    const readAll = async (dir: FileSystemDirectoryEntry) => {
      const reader = dir.createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (!batch.length) return all;
        all.push(...batch);
      }
    };
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') return;
      if (++seen > ZIP_LIMITS.maxEntries * 4)
        throw new Error(
          `This folder has too many files; the limit is ${ZIP_LIMITS.maxEntries}. Choose the project’s source folder only.`,
        );
      if (entry.isDirectory) {
        for (const child of await readAll(entry as FileSystemDirectoryEntry))
          await walk(child, `${prefix}${entry.name}/`);
      } else {
        const file = await new Promise<File>((res, rej) =>
          (entry as FileSystemFileEntry).file(res, rej),
        );
        out.push({ path: `${prefix}${entry.name}`, file });
      }
    };
    try {
      say('Reading the folder in your browser…');
      for (const e of entries) await walk(e, '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skippedMsg = msg;
      note(msg);
      say(msg);
      return;
    }
    await readFolder(out, entries[0]?.name ?? 'folder');
  }

  async function readFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    const zip = picked.find((f) => /\.zip$/i.test(f.name));
    if (zip) {
      await readZipFile(
        zip,
        picked.filter((f) => f !== zip),
      );
      return;
    }
    if (project) {
      // Files added to an unpacked project (its PDF or log, say) join it.
      const loose = await readLoose(picked);
      project.all = mergeFiles(project.all, loose.all);
      const notes = loose.skipped.length
        ? [`Skipped ${loose.skipped.join(', ')}: not a .log, .bib, .aux, .bcf, .tex or .pdf file.`]
        : [];
      if (!mainPick.hidden && !mainSelect.value) {
        note(notes.join(' '));
        return;
      }
      applyMain(mainPick.hidden ? project.main : mainSelect.value, notes.join(' '));
      return;
    }
    resetProject();
    const out: Loaded[] = [];
    const skipped: string[] = [];
    for (const file of picked) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
      const kind = kindOf(file.name, head);
      if (!kind) {
        skipped.push(file.name);
        continue;
      }
      if (kind === 'pdf') out.push({ name: file.name, kind, data: buf });
      else out.push({ name: file.name, kind, text: new TextDecoder('utf-8').decode(buf) });
    }
    clearSamples();
    add(out);
    skippedMsg = skipped.length
      ? `Skipped ${skipped.join(', ')}: not a .log, .bib, .aux, .bcf, .tex, .pdf or .zip file.`
      : '';
    note(skippedMsg);
    if (out.length) void run();
  }

  // ----- Input wiring -----
  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files?.length) void readFiles(input.files);
    input.value = '';
  });
  folderInput.webkitdirectory = true;
  chooseFolder.hidden = !('webkitdirectory' in folderInput);
  chooseFolder.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', () => {
    const picked = Array.from(folderInput.files ?? []);
    folderInput.value = '';
    if (!picked.length) return;
    void readFolder(
      picked.map((file) => ({ path: file.webkitRelativePath || file.name, file })),
      'folder',
    );
  });
  mainSelect.addEventListener('change', () => {
    if (mainSelect.value) applyMain(mainSelect.value, '');
  });
  for (const ev of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.dataset.active = 'true';
    });
  }
  for (const ev of ['dragleave', 'drop'] as const) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.dataset.active = 'false';
    });
  }
  drop.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    // Entries must be taken now: the items are gone once the handler returns.
    const entries = Array.from(dt.items ?? [])
      .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null))
      .filter((x): x is FileSystemEntry => !!x);
    if (entries.some((x) => x.isDirectory)) void readDropped(entries);
    else if (dt.files.length) void readFiles(dt.files);
  });
  // Dropping outside the zone should not navigate away to the file.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $<HTMLButtonElement>('#paste-add')?.addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('#paste-text')?.value ?? '';
    if (!text.trim()) {
      say('The paste box is empty.');
      return;
    }
    skippedMsg = '';
    resetProject();
    add([{ name: 'pasted.log', kind: 'log', text }]);
    void run();
  });

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
    if (!btn) return;
    files.splice(Number(btn.dataset.remove), 1);
    renderFiles();
    (files.length ? runBtn : choose).focus();
    if (files.length) void run();
  });
  $<HTMLButtonElement>('#clear')?.addEventListener('click', () => {
    files.length = 0;
    renderFiles();
    resetProject();
    skippedMsg = '';
    note('');
    tools.hidden = true;
    choose.focus();
    say('All files removed.');
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-sample]')) {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const s = samples.find((x) => x.id === btn.dataset.sample);
      if (!s) return;
      files.length = 0;
      skippedMsg = '';
      resetProject();
      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sample]'))
        b.setAttribute('aria-pressed', String(b === btn));
      add(
        s.files.map((f) => ({ name: f.name, kind: kindOf(f.name, f.text) ?? 'log', text: f.text })),
      );
      void run();
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void run();
  });
  stopBtn.addEventListener('click', () => controller?.abort());
  online.addEventListener('change', () => {
    if (files.some((f) => f.kind === 'bib')) void run();
  });
  profileSel.addEventListener('change', () => {
    if (files.length) void run();
  });

  agentToggle.addEventListener('click', () => {
    const on = agentToggle.getAttribute('aria-pressed') !== 'true';
    agentToggle.setAttribute('aria-pressed', String(on));
    agentView.hidden = !on;
    sheetView.hidden = on;
  });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = `${what} copied.`;
    } catch {
      copyStatus.textContent = `Could not copy. Select the ${what} text and copy it by hand.`;
    }
    window.setTimeout(() => (copyStatus.textContent = ''), 4000);
  }
  $<HTMLButtonElement>('#copy-json')?.addEventListener(
    'click',
    () => report && void copy(formatJson(report), 'JSON'),
  );
  $<HTMLButtonElement>('#copy-md')?.addEventListener(
    'click',
    () => report && void copy(formatMarkdown(report), 'Markdown'),
  );

  // ----- The run -----
  async function run() {
    if (!files.length) return;
    const id = ++runId;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    runBtn.disabled = true;
    const results = new Map<CheckId, CheckResult>();
    const logs = files.filter((f) => f.kind === 'log');
    const bibs = files.filter((f) => f.kind === 'bib');
    const auxes = files.filter((f) => f.kind === 'aux');
    const pdfs = files.filter((f) => f.kind === 'pdf');
    const texes = files.filter((f) => f.kind === 'tex');
    const profile = resolveProfile(profileSel.value);
    let facts: PdfFacts | undefined;
    let pdfError: string | undefined;
    const multiPdf =
      pdfs.length > 1 ? `One PDF at a time; checking the first: ${pdfs[0]?.name}.` : '';
    note([skippedMsg, multiPdf].filter(Boolean).join(' '));

    try {
      // Build and output, from the log
      if (logs.length) {
        say('Reading the build log…');
        const merged = mergeChecks(logs.map((l) => analyzeLog(l.text ?? '')));
        results.set('build', merged.build);
        results.set('output', merged.output);
      }

      // PDF facts: output (?? in text) and accessibility
      if (pdfs.length) {
        const pdf = pdfs[0] as Loaded;
        say(`Opening ${pdf.name} with pdf.js…`);
        const pdfjs = await loadPdfjs();
        try {
          facts = await extractPdfFacts(
            pdf.data ?? new Uint8Array(),
            pdfjs as unknown as PdfjsLike,
          );
        } catch (err) {
          pdfError = `${pdf.name}: This file isn’t a readable PDF (pdf.js: ${err instanceof Error ? err.message : String(err)}).`;
        }
        if (id !== runId) return;
      }
      if (facts && pdfs[0]) {
        const pdf = pdfs[0];
        const out = pdfOutputProblems(facts).map((p) => withFile(p, pdf.name));
        const prev = results.get('output');
        const outputProblems = [...(prev?.problems ?? []), ...out];
        results.set('output', {
          check: 'output',
          status: statusOf(outputProblems),
          problems: outputProblems,
          summary:
            prev?.summary ?? `${facts.pageCount} page${facts.pageCount === 1 ? '' : 's'} read`,
        });
        results.set(
          'accessibility',
          browserAccessibility(
            accessibilityCheck(facts, { verapdf: null, level: profile.accessibility }),
          ),
        );
      }

      // References
      if (bibs.length || auxes.length) {
        const entries: BibEntry[] = [];
        const issues: { line: number; message: string; key?: string }[] = [];
        for (const b of bibs) {
          const parsed = parseBibWithIssues(b.text ?? '');
          entries.push(...parsed.entries.map((e) => ({ ...e, file: b.name })));
          issues.push(...parsed.issues);
        }
        const cited = [...new Set(auxes.flatMap((a) => citedKeys(a.text ?? '')))];
        const extra = cited.length && bibs.length ? missingKeys(cited, entries) : [];
        const toCheck = cited.length ? entries.filter((e) => cited.includes(e.key)) : entries;
        if (!bibs.length) {
          results.set('references', {
            check: 'references',
            status: 'skipped',
            problems: [],
            skippedReason: `${cited.length} cited keys found; add the .bib file to check them`,
          });
        } else if (online.checked && toCheck.length) {
          stopBtn.hidden = false;
          const refResults: RefResult[] = [];
          const chunk = 3;
          for (let i = 0; i < toCheck.length; i += chunk) {
            if (signal.aborted) break;
            say(`Looking up references: ${i} of ${toCheck.length} done…`);
            setBar(i / toCheck.length);
            // arXiv and DBLP refuse cross-origin requests from web pages, so
            // only the sources a browser can reach are asked. (Core calls
            // fetch detached from globalThis, so window.fetch needs no wrapper.)
            const opts: RefsOptions = {
              sources: ['crossref', 'doi.org', 'openalex'],
              cache,
              signal,
              concurrency: chunk,
              timeoutMs: 12000,
              arxivIntervalMs: 3000,
            };
            const part = await verifyEntries(toCheck.slice(i, i + chunk), opts);
            if (id !== runId) return;
            refResults.push(...part);
          }
          setBar(null);
          stopBtn.hidden = true;
          const check = refsCheck(refResults, { entries, issues, bibFile: bibs[0]?.name, extra });
          if (signal.aborted && refResults.length < toCheck.length) {
            check.summary =
              `Stopped after ${refResults.length} of ${toCheck.length} references. ${check.summary ?? ''}`.trim();
          }
          results.set('references', check);
        } else {
          const offline = await verifyEntries(toCheck, { offline: true });
          const check = refsCheck(offline, { entries, issues, bibFile: bibs[0]?.name, extra });
          const note = `Online verification is off: ${toCheck.length} of ${entries.length} entries parsed, none looked up`;
          if (check.status === 'skipped' || offline.every((r) => r.reason === 'offline')) {
            check.skippedReason = note;
            check.summary = note;
            check.status = check.problems.length ? statusOf(check.problems) : 'skipped';
          }
          results.set('references', check);
        }
      }

      // Venue
      if (facts || texes.length || auxes.length) {
        const v = venueCheck(profile, {
          ...(facts ? { facts } : {}),
          ...(auxes.length ? { aux: auxes.map((a) => a.text ?? '').join('\n') } : {}),
          ...(texes.length
            ? { texFiles: texes.map((t) => ({ path: t.name, content: t.text ?? '' })) }
            : {}),
          ...(logs[0]?.text ? { log: logs[0].text } : {}),
        });
        results.set('venue', v);
      }
    } catch (err) {
      if (id !== runId) return;
      console.warn(err);
      say(`The check stopped with an error: ${err instanceof Error ? err.message : String(err)}`);
      runBtn.disabled = false;
      stopBtn.hidden = true;
      setBar(null);
      return;
    }
    if (id !== runId) return;

    note([skippedMsg, multiPdf, pdfError].filter(Boolean).join(' '));
    const reasons: Record<CheckId, string> = {
      build: 'No build log supplied',
      output: pdfError
        ? 'No build log, and the PDF could not be read'
        : 'No build log or PDF supplied',
      references: 'No .bib or .aux file supplied',
      accessibility: pdfError ? 'The PDF could not be read' : 'No PDF supplied',
      venue: 'No PDF, .tex or .aux file supplied',
    };
    const checks: CheckResult[] = CHECK_IDS.map(
      (c) =>
        results.get(c) ?? { check: c, status: 'skipped', problems: [], skippedReason: reasons[c] },
    );
    report = {
      tool: 'overfull',
      version: VERSION,
      target: project
        ? `${project.name}${project.main ? ` (main file: ${project.main})` : ''}`
        : files
            .filter((f) => f.kind !== 'pdf' || f === pdfs[0])
            .map((f) => f.name)
            .join(', '),
      status: reportStatus(checks),
      checks,
    };
    const rulesBase = config.rulesBase ?? '/rules/';
    sheetView.innerHTML = renderSheet(report, {
      // Uncommon veraPDF clause ids have no page; the 404 page forwards them.
      ruleHref: (r) => `${rulesBase}${r}/`,
      headingLevel: 3,
    });
    jsonOut.textContent = formatJson(report);
    tools.hidden = false;
    runBtn.disabled = false;
    const n = checks.flatMap((c) => c.problems);
    const errors = n.filter((p) => p.severity === 'error').length;
    const warnings = n.filter((p) => p.severity === 'warning').length;
    say(
      `Done. ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} across ${checks.filter((c) => c.status !== 'skipped').length} checks.`,
    );
  }
}

function withFile(p: Problem, file: string): Problem {
  return { ...p, location: { ...p.location, file: p.location?.file ?? file } };
}

/** Combines the build/output results of several logs into one pair. */
function mergeChecks(parts: { build: CheckResult; output: CheckResult }[]): {
  build: CheckResult;
  output: CheckResult;
} {
  if (parts.length === 1 && parts[0]) return parts[0];
  const merge = (key: 'build' | 'output'): CheckResult => {
    const problems = parts.flatMap((p) => p[key].problems);
    return { check: key, status: statusOf(problems), problems, summary: `${parts.length} logs` };
  };
  return { build: merge('build'), output: merge('output') };
}

/**
 * veraPDF cannot run in a browser, so its absence here is a note, not a
 * problem: full PDF/UA validation is `overfull check`'s job.
 */
function browserAccessibility(result: CheckResult): CheckResult {
  const problems = result.problems.map((p) =>
    p.rule === 'verapdf-not-run'
      ? {
          ...p,
          severity: 'info' as const,
          message:
            'veraPDF does not run in the browser. Full PDF/UA validation runs in `overfull check`.',
        }
      : p,
  );
  const counted = problems.filter((p) => p.severity !== 'info').length;
  return {
    ...result,
    problems,
    status: statusOf(problems),
    summary: counted
      ? `${counted} accessibility problem${counted === 1 ? '' : 's'}`
      : 'Tagged, language and title set',
  };
}
