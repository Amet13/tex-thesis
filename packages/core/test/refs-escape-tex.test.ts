import { describe, expect, it } from 'vitest';
import { escapeTex } from '../src/refs/entry.js';

describe('escapeTex', () => {
  it('escapes every LaTeX special in plain index text', () => {
    expect(escapeTex('A {fast} 50% & #1 a_b ^ ~ \\ c$')).toBe(
      'A \\{fast\\} 50\\% \\& \\#1 a\\_b \\^{} \\~{} \\textbackslash{} c\\$',
    );
  });
});
