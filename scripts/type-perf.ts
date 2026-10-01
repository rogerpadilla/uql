/**
 * What UQL's types cost a consuming project's compiler, measured on `dist` as a consumer compiles it (build
 * first): a project with no queries, the fixed cost, and one with `calls` blocks of them. A published version,
 * `bun run ts.perf 200 0.93.1`, is measured beside it. Instantiations are deterministic; the clock is not.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const calls = Number(process.argv[2] ?? 200);
const version = process.argv[3];
const built = resolve(root, 'packages/orm/dist/index.d.ts');

if (!(await Bun.file(built).exists())) {
  throw new Error(`no declarations at ${built} - run 'bun run build' first.`);
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

async function measure(declarations: string, blocks: number): Promise<string> {
  const dir = mkdtempSync(resolve(tmpdir(), 'uql-type-perf-'));
  try {
    writeFileSync(resolve(dir, 'entities.ts'), entities);
    writeFileSync(
      resolve(dir, 'calls.ts'),
      [
        /*ts*/ `import type { Querier } from 'uql-orm';`,
        /*ts*/ `import { Company, User } from './entities.js';`,
        /*ts*/ `export type Fixture = [Querier, typeof Company, typeof User];`,
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

/** A published version's declarations, unpacked from the tarball `npm pack` names on its last line, a tag resolved. */
async function published(version: string, dir: string): Promise<string> {
  const tarball = (await $`npm pack uql-orm@${version} --pack-destination ${dir}`.text()).trim().split('\n').at(-1);
  await $`tar -xzf ${resolve(dir, tarball ?? '')} -C ${dir}`;
  return resolve(dir, 'package/dist/index.d.ts');
}

const downloads = mkdtempSync(resolve(tmpdir(), 'uql-type-perf-published-'));
try {
  const targets = [['dist', built], ...(version ? [[version, await published(version, downloads)]] : [])];
  for (const [label, declarations] of targets) {
    console.log(`${label.padEnd(8)} fixed (0 queries)  ${await measure(declarations, 0)}`);
    console.log(`${label.padEnd(8)} ${String(calls * 4).padEnd(5)} queries      ${await measure(declarations, calls)}`);
  }
} finally {
  rmSync(downloads, { recursive: true, force: true });
}
