/**
 * A small Model Context Protocol server core: JSON-RPC 2.0 message handling,
 * no I/O, no dependencies. The stdio loop is in stdio.ts, the tools in tools.ts.
 *
 * Specification read on 2026-11-10: https://modelcontextprotocol.io/specification/2026-07-28
 * (latest revision, "2026-07-28"; stdio transport:
 * .../2026-07-28/basic/transports/stdio, tools: .../2026-07-28/server/tools,
 * discovery: .../2026-07-28/server/discover, legacy handshake:
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
 *
 * Two eras exist and this server speaks both, as the spec's "dual-era" server:
 *
 * - Modern, 2026-07-28: no handshake. Every request carries
 *   `_meta["io.modelcontextprotocol/protocolVersion"]` and `.../clientCapabilities`.
 *   A request that lacks the required fields is rejected with -32602; an
 *   unsupported version with -32022 and `data.supported`. `server/discover`
 *   answers with supported versions, capabilities and identity. Results carry
 *   `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`.
 * - Legacy, 2025-11-25 and earlier: `initialize` (version negotiation: answer
 *   the requested version if supported, else our latest), then
 *   `notifications/initialized`; `ping` is answered with `{}`.
 *
 * Both use the stdio framing: one JSON-RPC message per line, UTF-8, no
 * embedded newlines; the server writes nothing else to stdout.
 * Tool failures are results with `isError: true` (not JSON-RPC errors); an
 * unknown tool or malformed call is -32602. Notifications get no reply.
 */
import { type ToolDef, toolList, validateArgs } from './tools.js';

const MODERN_VERSIONS = ['2026-07-28'] as const;
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** The newest legacy revision: what `initialize` falls back to for a version we do not know. */
const LEGACY_LATEST = LEGACY_VERSIONS[0];

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unsupportedVersion: -32022,
} as const;

type Json = Record<string, unknown>;
type Id = string | number | null;

interface ErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpServerOptions {
  version: string;
  tools: ToolDef[];
  /** Diagnostics go here (stderr), never to stdout. */
  log?: (message: string) => void;
}

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const INSTRUCTIONS =
  'Overfull checks a LaTeX project before it is submitted. Run `check` after every build and fix ' +
  'what it reports; add references only with `cite` (never write BibTeX by hand), look at pages ' +
  'with `pages`, and use `explain` for what a rule id means. Tools work on the project folder the server was started in.';

export function createMcpServer(options: McpServerOptions) {
  const log = options.log ?? (() => {});
  const serverInfo = { name: 'overfull', title: 'Overfull', version: options.version };
  let legacyReady = false;
  // Tool calls run one at a time: `cite` writes a file and `check` reads it.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  const reply = (id: Id, result: Json) => JSON.stringify({ jsonrpc: '2.0', id, result });
  const fail = (id: Id, code: number, message: string, data?: unknown) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) } satisfies ErrorBody,
    });

  /** Dispatches a request that is allowed to run (era already decided). */
  async function dispatch(
    id: Id,
    method: string,
    params: Json,
    modern: boolean,
  ): Promise<string | undefined> {
    const done = (result: Json): string =>
      reply(
        id,
        modern
          ? { resultType: 'complete', ...result, _meta: { [META_SERVER_INFO]: serverInfo } }
          : result,
      );
    switch (method) {
      case 'ping':
        return done({});
      case 'tools/list':
        return done({ tools: toolList(options.tools) });
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string')
          return fail(id, ERR.invalidParams, 'tools/call needs a tool name');
        const tool = options.tools.find((t) => t.name === name);
        if (!tool) return fail(id, ERR.invalidParams, `Unknown tool: ${name.slice(0, 100)}`);
        const args = params.arguments ?? {};
        if (!isObject(args)) return fail(id, ERR.invalidParams, 'Tool arguments must be an object');
        const problem = validateArgs(tool.inputSchema, args);
        if (problem) {
          return done({
            content: [{ type: 'text', text: `Invalid arguments: ${problem}` }],
            isError: true,
          });
        }
        const out = await serial(() => tool.run(args));
        return done({ ...out });
      }
      default:
        return fail(id, ERR.methodNotFound, `Method not found: ${method.slice(0, 100)}`);
    }
  }

  /** Handles one line. Returns the response line (no newline), or undefined for notifications. */
  async function handle(line: string): Promise<string | undefined> {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return fail(null, ERR.parse, 'Parse error: the message is not valid JSON');
    }
    if (!isObject(msg) || msg.jsonrpc !== '2.0') {
      return fail(null, ERR.invalidRequest, 'Invalid request: expected a JSON-RPC 2.0 object');
    }
    const hasId = 'id' in msg;
    const method = msg.method;
    if (typeof method !== 'string') {
      // A response from the client (we send no requests) is ignored; anything else is invalid.
      if (hasId && ('result' in msg || 'error' in msg)) return undefined;
      return fail(null, ERR.invalidRequest, 'Invalid request: "method" must be a string');
    }
    if (!hasId) {
      // Notifications never get a reply; unknown ones are ignored.
      if (method === 'notifications/initialized') legacyReady = true;
      return undefined;
    }
    const id = msg.id;
    if (typeof id !== 'string' && typeof id !== 'number') {
      return fail(null, ERR.invalidRequest, 'Invalid request: "id" must be a string or a number');
    }
    const rawParams = msg.params;
    if (rawParams !== undefined && !isObject(rawParams)) {
      return fail(id, ERR.invalidParams, 'Invalid params: expected an object');
    }
    const params: Json = rawParams ?? {};
    const meta = isObject(params._meta) ? params._meta : undefined;
    const requested = meta?.[META_VERSION];

    try {
      if (method === 'initialize') {
        const v = params.protocolVersion;
        if (typeof v !== 'string') {
          return fail(id, ERR.invalidParams, 'initialize needs params.protocolVersion (a string)');
        }
        legacyReady = true;
        const version = (LEGACY_VERSIONS as readonly string[]).includes(v) ? v : LEGACY_LATEST;
        return reply(id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo,
          instructions: INSTRUCTIONS,
        });
      }
      if (requested !== undefined || method === 'server/discover') {
        // Modern era (or a discovery probe from a client that has not said which).
        if (requested !== undefined) {
          if (
            typeof requested !== 'string' ||
            !(MODERN_VERSIONS as readonly string[]).includes(requested)
          ) {
            return fail(id, ERR.unsupportedVersion, 'Unsupported protocol version', {
              supported: [...MODERN_VERSIONS],
              requested,
            });
          }
          if (!isObject(meta?.[META_CAPABILITIES])) {
            return fail(id, ERR.invalidParams, `_meta["${META_CAPABILITIES}"] is required`);
          }
        }
        if (method === 'server/discover') {
          return reply(id, {
            resultType: 'complete',
            supportedVersions: [...MODERN_VERSIONS],
            capabilities: { tools: {} },
            instructions: INSTRUCTIONS,
            _meta: { [META_SERVER_INFO]: serverInfo },
          });
        }
        return await dispatch(id, method, params, true);
      }
      if (method === 'ping') return reply(id, {});
      if (!legacyReady) {
        return fail(
          id,
          ERR.invalidParams,
          `Not initialized: send "initialize" first, or put _meta["${META_VERSION}"] (and "${META_CAPABILITIES}") on the request.`,
        );
      }
      return await dispatch(id, method, params, false);
    } catch (err) {
      log(
        `internal error in ${method}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      return fail(id, ERR.internal, 'Internal error');
    }
  }

  return { handle };
}
