#!/usr/bin/env node
import { processIo } from './io.js';
import { main } from './main.js';

main(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`overfull: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  },
);
