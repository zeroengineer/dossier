#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { main } from '../src/cli.js';

process.exitCode = await main(process.argv.slice(2));
