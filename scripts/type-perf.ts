/**
 * What UQL's types cost the compiler in a consuming project, so a change to the query types cannot
 * quietly make everyone's build slower. Generates a small project and type-checks it twice: with no
 * queries, which is the fixed cost of materializing the querier's signatures, and with `--calls` of
 * them, whose difference is what one more query costs.
 *
 * Measured against `dist`, which is what a consumer actually compiles against, so **`bun run build`
 * first** - including in the worktree, when measuring a before against another ref. Pointing at the
 * source instead put uql's own 39k lines in the program: the fixed cost read as 414k instantiations
 * where a consumer pays 4k, it moved whenever an implementation did, and it could not compile at all
 * under `types: []` (17 errors on `console`, `Buffer`, `TextDecoder`), which is the shape a consumer
 * has. `verify-dist` is what proves the declarations do compile there.
 *
 * Instantiations are deterministic; the wall clock is not, so compare that only within one run.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const calls = Number(process.argv[2] ?? 200);
const declarations = resolve(root, 'packages/orm/dist/index.d.ts');

if (!existsSync(declarations)) {
  throw new Error(`no declarations at ${declarations} - run 'bun run build' first.`);
}

const entities = /*ts*/ `import { Entity, Field, Id, idKey, ManyToOne, OneToMany } from 'uql-orm';

@Entity() export class Company {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: Number }) size?: number | null;
  @OneToMany({ entity: () => User, mappedBy: (u) => u.company }) users?: User[];
}
@Entity() export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: String }) email?: string | null;
  @Field({ type: Number }) age?: number | null;
  @Field({ type: Date }) createdAt?: Date | null;
  @Field({ type: Number, references: () => Company }) companyId?: number | null;
  @ManyToOne({ entity: () => Company, references: (u) => u.companyId }) company?: Company;
}
@Entity() export class Membership {
  [idKey]?: 'userId' | 'companyId';
  @Id({ type: Number }) userId?: number;
  @Id({ type: Number }) companyId?: number;
}
@Entity() export class Seat {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) memberUserId?: number | null;
  @Field({ type: Number }) memberCompanyId?: number | null;
  @ManyToOne({
    entity: () => Membership,
    references: (s, m) => [{ local: s.memberUserId, foreign: m.userId }, { local: s.memberCompanyId, foreign: m.companyId }],
  })
  member?: Membership;
}
`;

/** One block per call site, mixing the clauses a real query does: projection, filter, sort, relation, aggregate. */
const block = (i: number) => /*ts*/ `
export async function q${i}(q: Querier) {
  const a = await q.findMany(User, { $select: { id: true, name: true }, $where: { age: { $gte: ${i} } }, $sort: { createdAt: -1 } });
  const b = await q.findOne(User, { $exclude: { email: true }, $where: { name: 'x' } });
  const c = await q.findMany(Company, { $populate: { users: { $select: { name: true } } }, $where: { size: ${i} } });
  await q.insertMany(User, [{ name: 'x', age: ${i} }]);
  await q.updateMany(User, { $where: { age: ${i} } }, { name: 'y' });
  const d = await q.aggregate(User, {
    $group: { name: true, companyName: { company: { name: true } } },
    $select: { n: { $count: '*', $where: { age: { $gt: ${i} } } }, total: { $sum: { age: true } } },
    $having: { n: { $gt: ${i} } },
    $sort: { total: -1 },
  });
  return [a[0]?.name, b?.name, c[0]?.users, d[0]?.companyName];
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
          paths: { 'uql-orm': [declarations] },
        },
      }),
    );
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

console.log(`fixed (0 queries)   ${await measure(0)}`);
console.log(`${String(calls * 4).padEnd(5)} queries        ${await measure(calls)}`);
