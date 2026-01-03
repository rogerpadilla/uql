#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { main } from './cli.js';

/**
 * Check if the current module is being run as the main script (entry point).
 * This allows the file to be both imported as a library and executed as a standalone CLI tool.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
