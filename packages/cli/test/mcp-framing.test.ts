/** LineSplitter and serveStream: the MCP stdio framing, byte by byte. */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LineSplitter, serveStream } from '../src/mcp/stdio.js';

const b = (s: string) => Buffer.from(s, 'utf8');

describe('LineSplitter', () => {
  it('joins a message split across chunks, even inside a multi-byte character', () => {
    const s = new LineSplitter();
    const bytes = b('{"x":"é"}\n');
    expect(s.push(bytes.subarray(0, 7))).toEqual([]);
    expect(s.push(bytes.subarray(7))).toEqual([{ line: '{"x":"é"}' }]);
  });

  it('splits two messages in one chunk, drops CR and blank lines', () => {
    const s = new LineSplitter();
    expect(s.push(b('{"a":1}\r\n\n  \n{"b":2}\n'))).toEqual([
      { line: '{"a":1}' },
      { line: '{"b":2}' },
    ]);
  });

  it('reports one tooLarge event for an oversized line and recovers on the next', () => {
    const s = new LineSplitter(10);
    expect(s.push(b('0123456789AB'))).toEqual([{ tooLarge: true }]);
    expect(s.push(b('CDEF more of the same line'))).toEqual([]);
    expect(s.push(b('\n{"ok":1}\n'))).toEqual([{ line: '{"ok":1}' }]);
  });

  it('returns the last line without a newline at the end, but not a dropped one', () => {
    const s = new LineSplitter();
    s.push(b('{"last":true}'));
    expect(s.end()).toEqual([{ line: '{"last":true}' }]);
    expect(s.end()).toEqual([]);
    const big = new LineSplitter(4);
    big.push(b('too long'));
    expect(big.end()).toEqual([]);
    const blank = new LineSplitter();
    blank.push(b('   '));
    expect(blank.end()).toEqual([]);
  });
});

describe('serveStream', () => {
  it('writes each reply once, skips undefined replies and survives a failing handler', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const done = serveStream(
      input,
      (l) => out.push(l),
      async (line) => {
        const msg = JSON.parse(line) as { id?: number; boom?: boolean };
        if (msg.boom) throw new Error('boom');
        return msg.id === undefined ? undefined : JSON.stringify({ id: msg.id });
      },
    );
    input.write('{"id":1}\n{"method":"note"}\n{"boom":true}\n');
    input.end('{"id":2}');
    await done;
    expect(out.sort()).toEqual(['{"id":1}', '{"id":2}']);
  });

  it('answers an oversized message with a JSON-RPC error', async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const done = serveStream(
      input,
      (l) => out.push(l),
      async () => undefined,
    );
    input.end(Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    await done;
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { message: expect.stringContaining('Message too large') },
    });
  });
});
