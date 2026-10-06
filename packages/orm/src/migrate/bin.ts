#!/usr/bin/env node
import { main } from './cli.js';

// `main` reports its own failures and exits with 1, so it never rejects.
await main(process.argv.slice(2));
