import type { Problem } from '../types.js';
import { findCommands, grepTex, stripComments } from './tex.js';
import type { TexFile, VenueContext, VenueProfile } from './types.js';

const baseName = (path: string) => path.split('/').pop() ?? path;

/** Profiles that get the layout check: a page limit or a named style file, never generic/thesis. */
function layoutCheckApplies(profile: VenueProfile): boolean {
  if (profile.id === 'generic' || profile.id === 'thesis') return false;
  return profile.pageLimit !== undefined || (profile.styleFiles?.length ?? 0) > 0;
}

const NEGATIVE_SPACE_LENGTHS =
  'abovecaptionskip|belowcaptionskip|textfloatsep|floatsep|intextsep|dbltextfloatsep|dblfloatsep|abovedisplayskip|belowdisplayskip|abovedisplayshortskip|belowdisplayshortskip';
const PAGE_LENGTHS =
  'textheight|textwidth|columnsep|oddsidemargin|evensidemargin|topmargin|headheight|headsep|footskip|voffset|hoffset|marginparwidth|columnwidth|linewidth';
const GEOMETRY_KEYS =
  /\b(?:margin|left|right|top|bottom|lmargin|rmargin|tmargin|bmargin|textwidth|textheight|text|total|body|hmargin|vmargin|inner|outer|width|height|hscale|vscale|columnsep|footskip|headheight|headsep|marginparwidth)\s*=/;
/** Lines around a float or heading in which a negative `\vspace` counts as squeezing it. */
const NEAR = 3;

function problem(
  use: { file: string; line: number },
  kind: string,
  what: string,
  fix: string,
): Problem {
  return {
    rule: 'layout-tampering',
    check: 'venue',
    severity: 'warning',
    message: `${what}; check that your venue allows this`,
    location: { file: use.file, line: use.line },
    fix,
    data: { kind },
  };
}

/** The first number in a LaTeX value such as `0.95`, `.9` or `-2mm`. */
const num = (s: string) => {
  const m = /^\s*([+-]?\d*\.?\d+)/.exec(s);
  return m ? Number(m[1]) : undefined;
};

/**
 * `layout-tampering`: source commands commonly used to squeeze text into a page limit. Class
 * files and the style files the profile names are skipped (they define these values). Margin,
 * text-block and font-size changes are only looked for when the profile names a style file,
 * because only then is there an official layout to depart from.
 */
export function layoutProblems(profile: VenueProfile, ctx: VenueContext): Problem[] {
  if (!layoutCheckApplies(profile)) return [];
  const named = new Set((profile.styleFiles ?? []).map((f) => f.name));
  const strict = named.size > 0;
  const files: TexFile[] = (ctx.texFiles ?? []).filter(
    (f) => !/\.cls$/i.test(f.path) && !named.has(baseName(f.path)),
  );
  const out: Problem[] = [];
  const seen = new Set<string>();
  const add = (p: Problem) => {
    const key = `${p.location?.file}:${p.location?.line}:${p.data?.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  for (const f of files) {
    const lines = stripComments(f.content).split('\n');
    const nearAnchor = (i: number) =>
      lines
        .slice(Math.max(0, i - NEAR), i + NEAR + 1)
        .some((l) =>
          /\\(?:begin|end)\{(?:figure|table|wrapfigure|wraptable)\*?\}|\\caption\b|\\(?:sub)*section\b|\\paragraph\b/.test(
            l,
          ),
        );
    lines.forEach((line, i) => {
      const at = { file: f.path, line: i + 1 };
      const neg = /\\(vspace|vskip)\*?\s*\{?\s*(-[^}\s]*)/.exec(line);
      if (neg && nearAnchor(i)) {
        add(
          problem(
            at,
            'negative-vspace',
            `\`\\${neg[1]}{${neg[2]}}\` pulls a figure, table or heading closer to the text`,
            'Remove it, or check the venue’s formatting rules before you keep it',
          ),
        );
      }
      const skip = new RegExp(
        `\\\\(?:setlength|addtolength)\\s*\\{?\\\\(${NEGATIVE_SPACE_LENGTHS})\\}?\\s*\\{\\s*(-[^}]*)\\}`,
      ).exec(line);
      if (skip) {
        add(
          problem(
            at,
            'negative-skip',
            `\`\\${skip[1]}\` is set to ${skip[2]?.trim()}, which shrinks the space around floats or equations`,
            'Remove it, or check the venue’s formatting rules before you keep it',
          ),
        );
      }
      const stretch =
        /\\renewcommand\s*\{?\\baselinestretch\}?\s*\{([^}]*)\}/.exec(line) ??
        /\\(?:linespread|setstretch)\s*\{([^}]*)\}/.exec(line);
      const factor = stretch?.[1] === undefined ? undefined : num(stretch[1]);
      if (stretch && factor !== undefined && factor < 1) {
        add(
          problem(
            at,
            'line-spacing',
            `Line spacing is set to ${stretch[1]?.trim()} (below 1)`,
            'Remove it, or check the venue’s formatting rules before you keep it',
          ),
        );
      }
      if (strict) {
        const len = new RegExp(
          `\\\\(?:(?:setlength|addtolength)\\s*\\{?\\\\(${PAGE_LENGTHS})\\}?|(${PAGE_LENGTHS})\\s*=)`,
        ).exec(line);
        if (len) {
          const name = len[1] ?? len[2];
          add(
            problem(
              at,
              'page-length',
              `\`\\${name}\` is changed from the venue’s style`,
              'Remove it and use the venue’s style file as shipped',
            ),
          );
        }
        const geo = /\\(?:usepackage|geometry|newgeometry|RequirePackage)\b/.test(line)
          ? /geometry/.test(line) && GEOMETRY_KEYS.test(line)
          : false;
        if (geo) {
          add(
            problem(
              at,
              'geometry',
              'The `geometry` package changes margins or the text block',
              'Remove it and use the venue’s style file as shipped',
            ),
          );
        }
        if (/\\renewcommand\s*\{?\\(?:@normalsize|normalsize)\b/.test(line)) {
          add(
            problem(
              at,
              'font-size',
              'The base font size (`\\normalsize`) is redefined',
              'Remove it and use the venue’s style file as shipped',
            ),
          );
        }
      }
    });
  }

  for (const use of findCommands(files, ['usepackage', 'RequirePackage'])) {
    if (/(^|,)\s*savetrees\s*(,|$)/.test(use.arg)) {
      add(
        problem(
          use,
          'savetrees',
          'The `savetrees` package shrinks margins, spacing and fonts',
          'Remove it; most venues do not allow it',
        ),
      );
    }
  }

  if (strict) {
    for (const use of findCommands(files, ['documentclass'])) {
      const size = use.optional ? /(?:^|,)\s*(\d+(?:\.\d+)?pt)\s*(?:,|$)/.exec(use.optional) : null;
      if (size) {
        add(
          problem(
            use,
            'font-size',
            `The class option ${size[1]} sets the base font size`,
            'Remove it unless the venue’s instructions ask for that size',
          ),
        );
      }
    }
    for (const hit of grepTex(
      files.filter((f) => f.path === ctx.main),
      /\\fontsize\s*\{[^}]*\}\s*\{[^}]*\}\s*\\selectfont[^\n]*/,
    )) {
      const f = files.find((x) => x.path === hit.file);
      const body = f ? stripComments(f.content).search(/\\begin\{document\}/) : -1;
      const before = f ? stripComments(f.content).split('\n').slice(0, hit.line).join('\n') : '';
      if (body < 0 || before.length < body) {
        add(
          problem(
            hit,
            'font-size',
            'The base font size is set in the preamble with `\\fontsize`',
            'Remove it and use the venue’s style file as shipped',
          ),
        );
      }
    }
  }
  const order = new Map(files.map((f, n) => [f.path, n]));
  return out.sort(
    (a, b) =>
      (order.get(a.location?.file ?? '') ?? 0) - (order.get(b.location?.file ?? '') ?? 0) ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );
}
