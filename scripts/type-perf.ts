/**
 * What UQL's types cost a consuming project's compiler, measured on `dist` as a consumer compiles it (build
 * first): a project with no queries, the fixed cost, then `calls` blocks of queries, then `calls` indexed entities
 * of each form.
 * A published version, `bun run ts.perf 200 0.93.1`, is measured beside it. Instantiations are deterministic.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';
import { type FixtureSize, writeConsumerProject } from './typeFixture.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const calls = Number(process.argv[2] ?? 200);
const version = process.argv[3];
const built = resolve(root, 'packages/orm/dist/index.d.ts');

if (!(await Bun.file(built).exists())) {
  throw new Error(`no declarations at ${built} - run 'bun run build' first.`);
}

async function measure(declarations: string, size: FixtureSize): Promise<string> {
  const dir = mkdtempSync(resolve(tmpdir(), 'uql-type-perf-'));
  try {
    writeConsumerProject(dir, size, {
      target: 'es2025',
      module: 'NodeNext',
      lib: ['ESNext'],
      skipLibCheck: true,
      paths: { 'uql-orm': [declarations] },
    });
    const out = await $`${resolve(root, 'node_modules/.bin/tsc')} -p ${dir} --extendedDiagnostics`.nothrow().text();
    // A failed compile still prints counters, and a project that resolves nothing prints zeroes, so
    // the numbers are only worth reading once the fixture is known to have type-checked.
    const errors = out.split('\n').filter((line) => line.includes('error TS'));
    if (errors.length) {
      throw new TypeError(`the measured project does not compile:\n${errors.join('\n')}`);
    }
    const counters = /^(Instantiations|Check time):\s+(\S+)/gm;
    const read = [...out.matchAll(counters)].map(([, name, value]) => `${name}: ${value}`).join('  ');
    if (!read) {
      throw new TypeError(`no counters in tsc output - did 'uql-orm' resolve?\n${out}`);
    }
    return read;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A published version's declarations, unpacked from the tarball `npm pack` names on its last line, a tag resolved. */
async function published(version: string, dir: string): Promise<string> {
  const tarball = (await $`npm pack uql-orm@${version} --pack-destination ${dir}`.text()).trim().split('\n').at(-1);
  await $`tar -xzf ${resolve(dir, tarball ?? '')} -C ${dir}`;
  return resolve(dir, 'package/dist/index.d.ts');
}

const downloads = mkdtempSync(resolve(tmpdir(), 'uql-type-perf-published-'));
try {
  const targets = [['dist', built], ...(version ? [[version, await published(version, downloads)]] : [])];
  const rows: readonly (readonly [string, FixtureSize])[] = [
    ['fixed (0 queries)', { queries: 0, definitions: 0, defined: 0 }],
    [`${calls * 4} queries`, { queries: calls, definitions: 0, defined: 0 }],
    [`${calls} definitions`, { queries: 0, definitions: calls, defined: 0 }],
    [`${calls} defined`, { queries: 0, definitions: 0, defined: calls }],
  ];
  for (const [label, declarations] of targets) {
    for (const [what, size] of rows) {
      const read = await measure(declarations, size).catch((error: unknown) => {
        // A published version older than an API the fixture uses reports that, rather than ending the run.
        if (label === 'dist') throw error;
        return String(error).split('\n')[0];
      });
      console.log(`${label.padEnd(8)} ${what.padEnd(18)} ${read}`);
    }
  }
} finally {
  rmSync(downloads, { recursive: true, force: true });
}
