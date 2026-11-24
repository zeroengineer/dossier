#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
// MCP server over stdio (see docs/MCP.md). stdout is the protocol; diagnostics go to stderr.
import { main } from '../src/mcp.js';

main().catch((err) => {
  process.stderr.write(`dossier-mcp: cannot start: ${err?.message ?? err}\ndossier-mcp: set DOSSIER_HOME to a workspace folder (see docs/MCP.md)\n`);
  process.exitCode = 1;
});
