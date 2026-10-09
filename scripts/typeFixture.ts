/**
 * A consuming project as `tsc` sees it: decorated entities, then `blocks` call sites mixing the clauses a
 * real query does, with `uql-orm` resolved to `declarations`. Shared by `type-perf.ts` and `type-floor.ts`.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

export function writeFixture(
  dir: string,
  declarations: string,
  blocks: number,
  options: { readonly target: string; readonly skipLibCheck: boolean },
): void {
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ type: 'module' }));
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
        strict: true,
        noEmit: true,
        paths: { 'uql-orm': [declarations] },
        ...options,
      },
    }),
  );
}
