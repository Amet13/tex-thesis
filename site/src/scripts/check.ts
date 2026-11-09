/**
 * The browser check. Everything runs here, in the page: files are read with
 * the File API and analysed by @overfull/core. The only network requests are
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
  type RefSource,
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

  let report: Report | null = null;
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

  async function readFiles(list: FileList | File[]) {
    const out: Loaded[] = [];
    const skipped: string[] = [];
    for (const file of Array.from(list)) {
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
    for (const b of samples.length
      ? document.querySelectorAll<HTMLButtonElement>('[data-sample]')
      : [])
      b.setAttribute('aria-pressed', 'false');
    add(out);
    skippedMsg = skipped.length
      ? `Skipped ${skipped.join(', ')}: not a .log, .bib, .aux, .bcf, .tex or .pdf file.`
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
    if (dt?.files.length) void readFiles(dt.files);
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
          summary: prev?.summary ?? `${facts.pageCount} page${facts.pageCount === 1 ? '' : 's'} read`,
        });
        results.set(
          'accessibility',
          accessibilityCheck(facts, { verapdf: null, level: profile.accessibility }),
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
            const opts: RefsOptions & { sources?: RefSource[] } = {
              sources: ['crossref', 'doi.org'],
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
      output: pdfError ? 'No build log, and the PDF could not be read' : 'No build log or PDF supplied',
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
      target: files.map((f) => f.name).join(', '),
      status: reportStatus(checks),
      checks,
    };
    const rulesBase = config.rulesBase ?? '/rules/';
    sheetView.innerHTML = renderSheet(report, {
      ruleHref: (r) => `${rulesBase}${r.replace(/^verapdf-.*/, 'verapdf')}/`,
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
