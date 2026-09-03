/**
 * What UQL's types cost the compiler in a consuming project, so a change to the query types cannot
 * quietly make everyone's build slower. Generates a small project and type-checks it twice: with no
 * queries, which is the fixed cost of materializing the querier's signatures, and with `--calls` of
 * them, whose difference is what one more query costs.
 *
 * Instantiations are deterministic; the wall clock is not, so compare that only within one run.
 * For a before/after, check out the other ref in a worktree and run this there.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const calls = Number(process.argv[2] ?? 200);

const entities = /*ts*/ `import { Entity, Field, Id, ManyToOne, OneToMany } from 'uql-orm';

@Entity() export class Company {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @Field({ type: Number }) size?: number;
  @OneToMany({ entity: () => User, mappedBy: (u) => u.company }) users?: User[];
}
@Entity() export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @Field({ type: String }) email?: string;
  @Field({ type: Number }) age?: number;
  @Field({ type: Date }) createdAt?: Date;
  @Field({ type: Number, references: () => Company }) companyId?: number;
  @ManyToOne({ entity: () => Company }) company?: Company;
}
`;

/** One block per call site, mixing the clauses a real query does: projection, filter, sort, relation. */
const block = (i: number) => /*ts*/ `
export async function q${i}(q: Querier) {
  const a = await q.findMany(User, { $select: { id: true, name: true }, $where: { age: { $gte: ${i} } }, $sort: { createdAt: -1 } });
  const b = await q.findOne(User, { $exclude: { email: true }, $where: { name: 'x' } });
  const c = await q.findMany(Company, { $populate: { users: { $select: { name: true } } }, $where: { size: ${i} } });
  return [a[0]?.name, b?.name, c[0]?.users];
}`;

async function measure(blocks: number): Promise<string> {
  const dir = mkdtempSync(resolve(tmpdir(), 'uql-type-perf-'));
  try {
    writeFileSync(resolve(dir, 'entities.ts'), entities);
    writeFileSync(
      resolve(dir, 'calls.ts'),
      [
        /*ts*/ `import type { Querier } from 'uql-orm';`,
        /*ts*/ `import { Company, User } from './entities.js';`,
        /*ts*/ `void (0 as unknown as [Querier, typeof Company, typeof User]);`,
        ...Array.from({ length: blocks }, (_, i) => block(i)),
      ].join('\n'),
    );
    writeFileSync(
      resolve(dir, 'tsconfig.json'),
      // The source rather than `dist`, so a measurement needs no build: these are the same types the
      // published `.d.ts` projects.
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ESNext'],
          types: [],
          target: 'es2025',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          paths: { 'uql-orm': [`${root}/packages/uql-orm/src/index.ts`] },
        },
      }),
    );
    const out = await $`${resolve(root, 'node_modules/.bin/tsc')} -p ${dir} --extendedDiagnostics`.nothrow().text();
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

console.log(`fixed (0 queries)   ${await measure(0)}`);
console.log(`${String(calls * 3).padEnd(5)} queries        ${await measure(calls)}`);
