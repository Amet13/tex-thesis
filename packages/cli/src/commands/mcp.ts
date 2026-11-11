import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { parse, str } from '../args.js';
import { type Io, UsageError } from '../io.js';
import { createMcpServer } from '../mcp/protocol.js';
import { serveStream } from '../mcp/stdio.js';
import { createTools, type Runner } from '../mcp/tools.js';
import { VERSION } from '../version.js';

const mcpHelp = `Usage: overfull mcp [--cwd dir]

Run Overfull as a Model Context Protocol (MCP) server on stdin/stdout, for AI
tools that have no shell (desktop apps, cloud editors). An MCP client starts it;
you do not run it by hand.

Tools: check, cite, explain, pages, doctor. They work on the project in the
folder the server was started in (or --cwd), and write only inside it
(\`cite\` appends to the bibliography; \`pages\` writes PNGs to .overfull/pages).
The client cannot choose another folder or an output path.

Options:
  --cwd dir       Project folder (default: the current directory)
  -h, --help      Show this help

Configure an MCP client (the usual JSON form; the file name differs per client):

  {
    "mcpServers": {
      "overfull": {
        "command": "overfull",
        "args": ["mcp"]
      }
    }
  }

To pin the project, add "--cwd", "/path/to/project" to args. Clients that start
servers from another folder (most desktop apps) need --cwd.

Protocol: MCP 2026-07-28, and the 2025-11-25 and earlier initialize handshake.
Messages are newline-delimited JSON-RPC; logs go to stderr, never stdout.
`;

export async function mcpCommand(
  args: string[],
  io: Io,
  run: Runner,
  input: Readable = process.stdin,
): Promise<number> {
  const { values, positionals } = parse(args, { cwd: { type: 'string' } }, 'mcp');
  if (values.help) {
    io.stdout(mcpHelp);
    return 0;
  }
  if (positionals.length) {
    throw new UsageError(`Unexpected argument "${positionals[0]}". Run \`overfull mcp --help\`.`);
  }
  const cwd = resolve(io.cwd, str(values.cwd) ?? '.');
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UsageError(`--cwd "${str(values.cwd)}" is not a directory.`);
  }
  const server = createMcpServer({
    version: VERSION,
    tools: createTools({ cwd, env: io.env, ...(io.fetch ? { fetch: io.fetch } : {}), run }),
    log: (m) => io.stderr(`overfull mcp: ${m.replace(/\r?\n/g, ' ')}\n`),
  });
  if ((input as { isTTY?: boolean }).isTTY) {
    io.stderr(
      'overfull mcp: speaks MCP over stdin/stdout and is started by an MCP client. Press Ctrl-D to stop; see `overfull mcp --help`.\n',
    );
  }
  await serveStream(input, (line) => io.stdout(`${line}\n`), server.handle);
  return 0;
}
