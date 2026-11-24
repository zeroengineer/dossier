import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { initWorkspace } from './workspace/index.js';
import { openContext } from './context.js';
import { getNode } from './services/hierarchy.js';
import { reindexAll } from './services/searchIndex.js';
import { seedEntities } from './services/entities.js';
import { clearRenderCache, renderCacheDir } from './cache/renderCache.js';

/**
 * Command table. Each entry: `usage` (shown in help), `summary`, and `run(args, io) -> exit code`.
 * Later features add entries here.
 * @type {Record<string, { usage: string, summary: string, run: (args: string[], io: CliIo) => Promise<number>|number }>}
 */
export const commands = {
  init: {
    usage: 'init [dir]',
    summary: 'create a workspace from the shipped example (default dir: $DOSSIER_HOME or ./workspace)',
    run(args, io) {
      const target = args[0] ? args[0] : loadConfig(io.env, io.cwd).home;
      const home = initWorkspace(resolve(io.cwd, target));
      // First open of the new workspace: create the database and load seeds/entities.json.
      const ctx = openContext({ home, env: io.env });
      let seeded;
      try {
        seeded = seedEntities(ctx);
      } finally {
        ctx.close();
      }
      io.stdout.write(`Created workspace at ${home}\n${seedSummary(seeded)}\n`
        + `Edit brands/acme/brand.json (or add brands) and set DOSSIER_HOME=${home}\n`);
      return 0;
    },
  },
  seed: {
    usage: 'seed',
    summary: 'load seeds/entities.json into the entity list (idempotent; never overwrites edits)',
    run(args, io) {
      if (args.length) throw new Error(`unexpected argument ${args[0]}`);
      const ctx = openContext({ home: loadConfig(io.env, io.cwd).home, env: io.env });
      try {
        io.stdout.write(`${seedSummary(seedEntities(ctx))}\n`);
      } finally {
        ctx.close();
      }
      return 0;
    },
  },
  serve: {
    usage: 'serve [--port N] [--host H]',
    summary: 'start the web UI and JSON API (default http://127.0.0.1:4400; HOST / PORT env)',
    async run(args, io) {
      const opts = {};
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--port' || a === '--host') {
          const v = args[++i];
          if (v === undefined) throw new Error(`${a} needs a value`);
          if (a === '--port') {
            if (!/^\d+$/.test(v) || Number(v) > 65535) throw new Error(`bad port ${v}`);
            opts.port = Number(v);
          } else {
            opts.host = v;
          }
        } else {
          throw new Error(`unknown option ${a}`);
        }
      }
      const { start } = await import('./server.js');
      const { app, url } = await start({ env: io.env, cwd: io.cwd, ...opts });
      io.stdout.write(`Dossier is running at ${url} (Ctrl+C to stop)\n`);
      await new Promise((resolveStop) => {
        const stop = () => resolveStop();
        if (io.signal) {
          if (io.signal.aborted) stop();
          else io.signal.addEventListener('abort', stop, { once: true });
        } else {
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        }
      });
      await app.close();
      return 0;
    },
  },
  tree: {
    usage: 'tree [node-id] [--folders] [--json]',
    summary: 'print the folder tree generated from document metadata (--folders: no documents)',
    run(args, io) {
      const flags = new Set(args.filter((a) => a.startsWith('--')));
      for (const f of flags) if (!['--folders', '--json'].includes(f)) throw new Error(`unknown option ${f}`);
      const [nodeId = ''] = args.filter((a) => !a.startsWith('--'));
      const ctx = openContext({ home: loadConfig(io.env, io.cwd).home, env: io.env });
      try {
        const node = getNode(ctx, nodeId);
        io.stdout.write(flags.has('--json') ? `${JSON.stringify(node, null, 2)}\n` : renderTree(node, { documents: !flags.has('--folders') }));
      } finally {
        ctx.close();
      }
      return 0;
    },
  },
  reindex: {
    usage: 'reindex',
    summary: 'rebuild the full-text search index from the database',
    run(args, io) {
      if (args.length) throw new Error(`unexpected argument ${args[0]}`);
      const ctx = openContext({ home: loadConfig(io.env, io.cwd).home, env: io.env });
      try {
        const { documents } = reindexAll(ctx);
        io.stdout.write(`Reindexed ${documents} document${documents === 1 ? '' : 's'}\n`);
      } finally {
        ctx.close();
      }
      return 0;
    },
  },
  cache: {
    usage: 'cache clear',
    summary: 'delete the rendered-file cache (<workspace>/data/cache/render); it refills as documents are rendered',
    run(args, io) {
      if (args[0] !== 'clear' || args.length > 1) throw new Error(args.length ? `unknown cache command "${args.join(' ')}" (expected: cache clear)` : 'expected: cache clear');
      const config = loadConfig(io.env, io.cwd);
      const { files, bytes } = clearRenderCache({ config });
      io.stdout.write(`Cleared ${files} cached file${files === 1 ? '' : 's'} (${(bytes / (1024 * 1024)).toFixed(1)} MB) from ${renderCacheDir({ config })}\n`);
      return 0;
    },
  },
  help: {
    usage: 'help',
    summary: 'show this help',
    run(_args, io) {
      io.stdout.write(usage());
      return 0;
    },
  },
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const seedSummary = (r) => `Seeded ${plural(r.entitiesCreated, 'entity', 'entities')} (${r.entitiesUpdated} updated), `
  + `${plural(r.aliasesAdded, 'alias', 'aliases')}, ${plural(r.relationsCreated, 'relation', 'relations')}`;

const countDocs = (node) => node.documents.length + node.children.reduce((sum, c) => sum + countDocs(c), 0);

/**
 * Plain-text rendering of a tree node: one indented line per folder with its document count, documents listed
 * under their folder as `- <display name>  [<id>, <status>]`.
 * @param {import('./services/hierarchy.js').TreeNode} node
 * @param {{ documents?: boolean }} [opts]
 * @returns {string}
 */
export function renderTree(node, { documents = true } = {}) {
  const lines = [];
  const walk = (n, depth) => {
    const pad = '  '.repeat(depth);
    lines.push(`${pad}${n.name}  (${countDocs(n)})  [${n.id}]`);
    for (const c of n.children) walk(c, depth + 1);
    if (documents) for (const d of n.documents) lines.push(`${pad}  - ${d.displayName}  [${d.id}, ${d.status}]`);
  };
  if (node.id === '') {
    for (const c of node.children) walk(c, 0);
  } else {
    walk(node, 0);
  }
  return `${lines.join('\n')}\n`;
}

function usage() {
  const width = Math.max(...Object.values(commands).map((c) => c.usage.length));
  const lines = Object.values(commands).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`);
  return `Usage: dossier <command> [args]\n\nCommands:\n${lines.join('\n')}\n`;
}

/**
 * @typedef {{ stdout: { write(s: string): any }, stderr: { write(s: string): any }, env: Record<string, string|undefined>, cwd: string,
 *   signal?: AbortSignal }} CliIo `signal` stops long-running commands (serve) instead of SIGINT/SIGTERM
 */

/**
 * Run the CLI.
 * @param {string[]} argv arguments after the executable (e.g. ['init', 'my-ws'])
 * @param {Partial<CliIo>} [io]
 * @returns {Promise<number>} process exit code
 */
export async function main(argv, io = {}) {
  const full = { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd(), ...io };
  const [name = 'help', ...args] = argv;
  const cmd = Object.hasOwn(commands, name) ? commands[name] : name === '--help' || name === '-h' ? commands.help : null;
  if (!cmd) {
    full.stderr.write(`Unknown command "${name}"\n\n${usage()}`);
    return 1;
  }
  try {
    return await cmd.run(args, full);
  } catch (e) {
    full.stderr.write(`dossier ${name}: ${e.message}\n`);
    return 1;
  }
}
