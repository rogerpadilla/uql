import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { provisioningTimeout } from '../test/spec.util.js';
import { getKeys } from '../util/object.util.js';

/** KB per call on Node 24, about 4% over what each measures: room for a Node patch, none for a regression. */
const BUDGET_KB = { readMany: 136, readNested: 93, readOne: 31.5, insertMany: 47.5 };

/** `test/pgAllocation.ts` bundled with its decorators lowered, as the tests run it, and run by plain Node. */
async function measured(): Promise<Partial<Record<keyof typeof BUDGET_KB, number>>> {
  const outfile = resolve(import.meta.dirname, '../../node_modules/.cache/uql/pgAllocation.mjs');
  await build({
    entryPoints: [resolve(import.meta.dirname, '../test/pgAllocation.ts')],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'es2025',
    logLevel: 'silent',
  });
  const { stdout } = await promisify(execFile)(process.execPath, [outfile]);
  return JSON.parse(stdout);
}

it(
  'should keep each step of a lifecycle within its allocation budget (PostgreSQL)',
  async () => {
    const kb = await measured();

    const overBudget = getKeys(BUDGET_KB)
      .filter((step) => !(Number(kb[step]) < BUDGET_KB[step]))
      .map((step) => `${step}: ${kb[step]}KB`);
    expect(overBudget).toEqual([]);
  },
  provisioningTimeout,
);
