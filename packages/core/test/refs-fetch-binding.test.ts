import { expect, it } from 'vitest';
import { lookup } from '../src/refs/index.js';

it('calls fetch with globalThis as receiver (browsers reject any other this)', async () => {
  let receiver: unknown = 'unset';
  const strictFetch = function (this: unknown, _url: string | URL | Request) {
    receiver = this;
    if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation');
    return Promise.resolve(new Response('{}', { status: 404 }));
  } as typeof fetch;
  await lookup('10.1145/0000000.0000000', { fetch: strictFetch, retryDelayMs: 0 });
  expect(receiver === globalThis || receiver === undefined).toBe(true);
});
