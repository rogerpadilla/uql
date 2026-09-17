#!/usr/bin/env node
import { parseArgs } from './cli.js';
import { run } from './index.js';

const USAGE = 'usage: uql-codemod [--project=<path>] [--include=<a,b>] [--dry-run]';

// Exit 2 is "could not start", so a script can tell it apart from exit 1, "there is work left".
const stop = (message: string): never => {
  console.error(message);
  process.exit(2);
};

const { options, errors } = parseArgs(process.argv.slice(2));
if (errors.length) {
  stop([...errors, USAGE].join('\n'));
}

// A wrong `--project` is the likeliest mistake here, and reporting it as a stack trace read as a crash.
const summary = await run(options).catch((error: unknown) => stop(error instanceof Error ? error.message : USAGE));

for (const line of summary.notes) {
  console.log(`worth a look: ${line}`);
}
for (const line of summary.unresolved) {
  console.error(`needs a decision: ${line}`);
}
console.log(`${summary.changed.length} file(s) ${options.dryRun ? 'would change' : 'changed'}`);
if (summary.unresolved.length) {
  console.error(`${summary.unresolved.length} property(ies) left untouched; see above`);
  process.exit(1);
}
