#!/usr/bin/env node
// Entry point for `pnpm snap`. Runs from the repository root.
import { main } from './runner.js';

process.exitCode = await main(process.argv.slice(2), { root: process.cwd(), out: (line) => console.log(line) });
