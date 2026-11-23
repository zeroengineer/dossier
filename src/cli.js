import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { initWorkspace } from './workspace/index.js';

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
      io.stdout.write(`Created workspace at ${home}\nEdit brands/acme/brand.json (or add brands) and set DOSSIER_HOME=${home}\n`);
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

function usage() {
  const width = Math.max(...Object.values(commands).map((c) => c.usage.length));
  const lines = Object.values(commands).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`);
  return `Usage: dossier <command> [args]\n\nCommands:\n${lines.join('\n')}\n`;
}

/**
 * @typedef {{ stdout: { write(s: string): any }, stderr: { write(s: string): any }, env: Record<string, string|undefined>, cwd: string }} CliIo
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
