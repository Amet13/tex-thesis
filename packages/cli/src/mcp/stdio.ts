/** Newline-delimited JSON-RPC over a byte stream (the MCP stdio framing). */
import type { Readable } from 'node:stream';
import { ERR } from './protocol.js';

/** A single incoming message may be at most this many bytes. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

export type LineEvent = { line: string } | { tooLarge: true };

/** Splits a byte stream into lines; a line over the limit is dropped (one `tooLarge` event). */
export class LineSplitter {
  private chunks: Buffer[] = [];
  private size = 0;
  private skipping = false;

  constructor(private readonly limit = MAX_MESSAGE_BYTES) {}

  push(chunk: Buffer): LineEvent[] {
    const events: LineEvent[] = [];
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      const end = nl === -1 ? chunk.length : nl;
      const piece = chunk.subarray(start, end);
      if (!this.skipping) {
        this.size += piece.length;
        if (this.size > this.limit) {
          this.skipping = true;
          this.chunks = [];
          events.push({ tooLarge: true });
        } else this.chunks.push(piece);
      }
      if (nl === -1) break;
      if (!this.skipping) {
        const line = Buffer.concat(this.chunks).toString('utf8').replace(/\r$/, '');
        if (line.trim() !== '') events.push({ line });
      }
      this.chunks = [];
      this.size = 0;
      this.skipping = false;
      start = nl + 1;
    }
    return events;
  }

  /** The last line when the stream ends without a trailing newline. */
  end(): LineEvent[] {
    if (this.skipping || this.size === 0) return [];
    const line = Buffer.concat(this.chunks).toString('utf8').replace(/\r$/, '');
    this.chunks = [];
    this.size = 0;
    return line.trim() === '' ? [] : [{ line }];
  }
}

/**
 * Reads messages from `input`, answers each through `handle`, and writes the
 * replies with `write` (one line each). Resolves once the input has ended and
 * every reply is written.
 */
export function serveStream(
  input: Readable,
  write: (line: string) => void,
  handle: (line: string) => Promise<string | undefined>,
): Promise<void> {
  return new Promise((resolve) => {
    const splitter = new LineSplitter();
    const pending = new Set<Promise<void>>();
    const run = (ev: LineEvent) => {
      const p = (
        'tooLarge' in ev
          ? Promise.resolve(
              JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: ERR.invalidRequest,
                  message: `Message too large: the limit is ${MAX_MESSAGE_BYTES} bytes`,
                },
              }),
            )
          : handle(ev.line)
      )
        .then((reply) => {
          if (reply !== undefined) write(reply);
        })
        .catch(() => {})
        .finally(() => pending.delete(p));
      pending.add(p);
    };
    input.on('data', (chunk: Buffer | string) => {
      for (const ev of splitter.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
        run(ev);
    });
    const finish = () => {
      for (const ev of splitter.end()) run(ev);
      Promise.allSettled([...pending]).then(() => resolve());
    };
    input.on('end', finish);
    input.on('close', finish);
    input.on('error', finish);
  });
}
