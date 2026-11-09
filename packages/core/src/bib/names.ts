import { texToPlain } from './tex.js';

export interface PersonName {
  /** Family name incl. von/jr parts, TeX stripped (`Erdős`, `van der Aalst`). */
  family: string;
  given: string;
  /** True for `{ATLAS Collaboration}`-style corporate authors. */
  corporate: boolean;
}

/**
 * Splits a string on a separator regex (written anchored, `^…`), ignoring matches inside
 * braces. Linear time: the separator is tried with a sticky regex (no slicing), and a
 * separator that starts with whitespace is only tried at the start of a whitespace run
 * (a match starting inside the run would have matched at its start).
 */
function splitTopLevel(s: string, sep: RegExp): string[] {
  const sticky = new RegExp(sep.source.replace(/^\^/, ''), `${sep.flags.replace(/[gy]/g, '')}y`);
  const leadingSpace = /^\^?\\s/.test(sep.source);
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0) {
      if (leadingSpace && i > 0 && /\s/.test(s[i - 1] ?? '') && /\s/.test(c ?? '')) continue;
      sticky.lastIndex = i;
      const m = sticky.exec(s);
      if (m) {
        parts.push(s.slice(last, i));
        i += m[0].length - 1;
        last = i + 1;
      }
    }
  }
  parts.push(s.slice(last));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseOne(raw: string): PersonName {
  const trimmed = raw.trim();
  if (/^\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}$/.test(trimmed)) {
    return { family: texToPlain(trimmed), given: '', corporate: true };
  }
  const commaParts = splitTopLevel(trimmed, /^,/);
  if (commaParts.length >= 2) {
    // "von Last, First" or "von Last, Jr, First"
    return {
      family: texToPlain(commaParts[0] as string),
      given: texToPlain(commaParts[commaParts.length - 1] as string),
      corporate: false,
    };
  }
  const words = splitTopLevel(trimmed, /^\s+/);
  if (words.length <= 1) return { family: texToPlain(trimmed), given: '', corporate: false };
  // "First von Last": the von part starts at the first lowercase word that is not the last one.
  let split = words.length - 1;
  for (let i = 1; i < words.length - 1; i++) {
    if (/^[a-z]/.test(words[i] as string)) {
      split = i;
      break;
    }
  }
  return {
    family: texToPlain(words.slice(split).join(' ')),
    given: texToPlain(words.slice(0, split).join(' ')),
    corporate: false,
  };
}

/** Parses a BibTeX name list (`A and B and others`). `others` is dropped. */
export function parseNames(field: string | undefined): PersonName[] {
  if (!field) return [];
  return splitTopLevel(field, /^\s+and\s+/i)
    .filter((n) => n.toLowerCase() !== 'others')
    .map(parseOne);
}

/** True when the list ends with `and others` (the record may have more authors). */
export function hasOthers(field: string | undefined): boolean {
  return !!field && /(?:^|\s)and\s+others$/i.test(field.trimEnd());
}
