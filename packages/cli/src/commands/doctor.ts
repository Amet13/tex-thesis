import { parse, str } from '../args.js';
import { DEFAULT_IMAGE, loadConfig } from '../config.js';
import type { Io } from '../io.js';
import {
  dockerAvailable,
  dockerImageStatus,
  imageUnavailableMessage,
  run,
  which,
} from '../tools.js';
import { VERSION } from '../version.js';

export const doctorHelp = `Usage: overfull doctor [--json]

Show which tools Overfull can use on this machine and whether the project
config is valid. Exits 1 when nothing can build the document (no local
TeX Live and no usable Docker image); other missing tools only limit what can run.

Options:
  --json          Print the results as JSON
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help
`;

interface Item {
  name: string;
  ok: boolean;
  detail: string;
  /** What the missing tool is needed for. */
  needFor?: string;
}

async function versionOf(cmd: string, args: string[], pattern: RegExp): Promise<string> {
  const r = await run(cmd, args, { timeoutMs: 15000 });
  const text = `${r.stdout}\n${r.stderr}`;
  return pattern.exec(text)?.[1] ?? (text.trim().split('\n')[0] ?? '').slice(0, 60);
}

async function tool(
  name: string,
  cmd: string,
  args: string[],
  pattern: RegExp,
  needFor: string,
  env: Io['env'],
): Promise<Item> {
  const path = which(cmd, env);
  if (!path) return { name, ok: false, detail: 'not found', needFor };
  return { name, ok: true, detail: await versionOf(cmd, args, pattern) };
}

async function reachable(url: string, f: typeof fetch): Promise<Item> {
  try {
    const res = await f(url, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
    return { name: 'api.crossref.org', ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError' ? 'timed out after 2s' : 'unreachable';
    return {
      name: 'api.crossref.org',
      ok: false,
      detail: reason,
      needFor: 'reference checks (use --offline without network)',
    };
  }
}

export async function doctorCommand(args: string[], io: Io): Promise<number> {
  const { values } = parse(
    args,
    { json: { type: 'boolean' }, config: { type: 'string' } },
    'doctor',
  );
  if (values.help) {
    io.stdout(doctorHelp);
    return 0;
  }
  const env = io.env;
  const items: Item[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  const nodeOk = major >= 26;
  items.push({
    name: 'node',
    ok: nodeOk,
    detail: `v${process.versions.node}${nodeOk ? '' : ' (need 26 or newer)'}`,
  });
  items.push({ name: 'overfull', ok: true, detail: VERSION });

  let image = DEFAULT_IMAGE;
  let configItem: Item;
  try {
    const config = loadConfig(io.cwd, str(values.config), env);
    image = config.build.image;
    configItem = {
      name: 'overfull.yml',
      ok: true,
      detail: config.file
        ? `valid (main ${config.main}, profile ${config.profile.id})`
        : `none, using defaults (main ${config.main})`,
    };
  } catch (err) {
    configItem = {
      name: 'overfull.yml',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const checks = await Promise.all([
    tool(
      'latexmk',
      'latexmk',
      ['-v'],
      /Version\s+(\S+)/,
      'local builds (otherwise Docker is used)',
      env,
    ),
    tool(
      'lualatex',
      'lualatex',
      ['--version'],
      /(LuaH?B?TeX[^\n]*?)(?:\s*\(|$)/m,
      'local builds',
      env,
    ),
    tool(
      'biber',
      'biber',
      ['--version'],
      /version:?\s*(\S+)/i,
      'biblatex bibliographies in local builds',
      env,
    ),
    tool(
      'pdftoppm',
      'pdftoppm',
      ['-v'],
      /version\s+(\S+)/i,
      '`overfull pages` without Docker',
      env,
    ),
    tool('pdffonts', 'pdffonts', ['-v'], /version\s+(\S+)/i, 'font-embedding checks', env),
    tool('verapdf', 'verapdf', ['--version'], /veraPDF\s+(\S+)/, 'full PDF/UA validation', env),
    tool(
      'latexdiff',
      'latexdiff-vc',
      ['--version'],
      /(\d+\.\d+(?:\.\d+)?)/,
      '`overfull diff` without Docker',
      env,
    ),
    tool('git', 'git', ['--version'], /version\s+(\S+)/, '`overfull diff`', env),
  ]);
  items.push(...checks);
  const docker = await dockerAvailable(env);
  items.push(
    which('docker', env)
      ? {
          name: 'docker',
          ok: docker,
          detail: docker ? 'running' : 'installed but not running',
          needFor: 'builds without TeX Live',
        }
      : { name: 'docker', ok: false, detail: 'not found', needFor: 'builds without TeX Live' },
  );
  let imageOk = false;
  if (docker) {
    const status = await dockerImageStatus(image);
    imageOk = status === 'local' || status === 'remote';
    items.push({
      name: 'image',
      ok: imageOk,
      detail:
        status === 'local'
          ? image
          : status === 'remote'
            ? `${image} not pulled yet (first build pulls it)`
            : status === 'unavailable'
              ? imageUnavailableMessage(image)
              : `${image} not present locally, and the registry did not answer`,
      needFor: 'Docker builds',
    });
  }
  items.push(await reachable('https://api.crossref.org/works?rows=0', io.fetch ?? fetch));
  items.push(configItem);

  const localBuild = items.some((i) => i.name === 'latexmk' && i.ok);
  const canBuild = localBuild || (docker && imageOk);
  const verdict = canBuild
    ? 'Ready to build.'
    : docker
      ? `Cannot build: no local TeX Live, and the Docker image is not available. ${imageUnavailableMessage(image)}`
      : 'Cannot build: neither TeX Live (latexmk) nor Docker is available. Install Docker (recommended) or TeX Live.';
  if (values.json) {
    io.stdout(`${JSON.stringify({ canBuild, message: verdict, items }, null, 2)}\n`);
    return canBuild ? 0 : 1;
  }
  const w = Math.max(...items.map((i) => i.name.length)) + 2;
  const lines = items.map(
    (i) =>
      `  ${i.ok ? '✓' : '–'} ${i.name.padEnd(w)}${i.detail}${!i.ok && i.needFor ? ` (needed for ${i.needFor})` : ''}`,
  );
  // A machine that cannot build at all says so first, and exits 1.
  io.stdout(
    canBuild ? `${lines.join('\n')}\n\n${verdict}\n` : `${verdict}\n\n${lines.join('\n')}\n`,
  );
  return canBuild ? 0 : 1;
}
