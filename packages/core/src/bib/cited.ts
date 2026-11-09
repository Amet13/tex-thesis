function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function* auxKeys(text: string): Generator<string> {
  // \citation{a,b} (BibTeX) and \abx@aux@cite{refsection}{key} / older \abx@aux@cite{key} (biblatex).
  const re = /\\citation\{([^}]*)\}|\\abx@aux@cite\{([^}]*)\}(?:\{([^}]*)\})?/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) yield* m[1].split(',');
    else yield (m[3] ?? m[2]) as string;
  }
}

function* bcfKeys(text: string): Generator<string> {
  for (const m of text.matchAll(/<bcf:citekey\b[^>]*>([^<]*)<\/bcf:citekey>/g)) {
    yield unescapeXml(m[1] as string);
  }
}

/**
 * Cited keys from a `.aux` file or a biber `.bcf` file, deduplicated in first-cited
 * order. `\nocite{*}` (`*`) is excluded.
 */
export function citedKeys(auxOrBcf: string): string[] {
  const isBcf = /<bcf:citekey\b/.test(auxOrBcf);
  const seen = new Set<string>();
  for (const raw of isBcf ? bcfKeys(auxOrBcf) : auxKeys(auxOrBcf)) {
    const key = raw.trim();
    if (key && key !== '*') seen.add(key);
  }
  return [...seen];
}

/**
 * True when a `.aux` or `.bcf` file records `\nocite{*}` (every bibliography entry is
 * cited): `\citation{*}`, `\abx@aux@cite{0}{*}` or `<bcf:citekey>*</bcf:citekey>`.
 */
export function citesAll(auxOrBcf: string): boolean {
  const isBcf = /<bcf:citekey\b/.test(auxOrBcf);
  for (const raw of isBcf ? bcfKeys(auxOrBcf) : auxKeys(auxOrBcf)) {
    if (raw.trim() === '*') return true;
  }
  return false;
}
