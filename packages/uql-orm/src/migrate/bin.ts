#!/usr/bin/env node
import { main } from './cli.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
