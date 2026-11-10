import type { Problem } from '../types.js';
import type { VenueContext, VenueProfile } from './types.js';

/** Text this far past the block edge (mm) is reported; less is rounding and glyph overhang. */
export const TOLERANCE_MM = 2;

/**
 * `text-outside-block`: text printed outside the venue's text block, measured on every page
 * of the PDF. Only for profiles that give a `textBlock` (from the venue's style file).
 */
export function marginProblems(profile: VenueProfile, ctx: VenueContext): Problem[] {
  const block = profile.textBlock;
  if (!block || !ctx.facts) return [];
  const out: Problem[] = [];
  for (const page of ctx.facts.pages) {
    const box = page.textBox;
    if (!box) continue;
    const left = block.leftMm ?? (page.widthMm - block.widthMm) / 2;
    const right = left + block.widthMm;
    const past: string[] = [];
    const over = (mm: number) => Math.round(mm * 10) / 10;
    if (box.leftMm < left - TOLERANCE_MM)
      past.push(`${over(left - box.leftMm)} mm into the left margin`);
    if (box.rightMm > right + TOLERANCE_MM)
      past.push(`${over(box.rightMm - right)} mm into the right margin`);
    if (block.topMm !== undefined && block.heightMm !== undefined) {
      const top = block.topMm;
      const bottom = top + block.heightMm;
      if (box.topMm < top - TOLERANCE_MM)
        past.push(`${over(top - box.topMm)} mm into the top margin`);
      if (box.bottomMm > bottom + TOLERANCE_MM)
        past.push(`${over(box.bottomMm - bottom)} mm into the bottom margin`);
    }
    if (!past.length) continue;
    out.push({
      rule: 'text-outside-block',
      check: 'venue',
      severity: 'warning',
      message: `Text on page ${page.number} reaches ${past.join(' and ')} (text block ${block.widthMm} mm wide for ${profile.name})`,
      location: { page: page.number },
      fix: 'Find the overfull line, table or figure on that page (`overfull pages` renders it) and make it fit; do not change the margins.',
      data: { page: page.number, textBox: box, textBlock: block },
    });
  }
  return out;
}
