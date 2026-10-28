/**
 * A consuming project as `tsc` sees it: decorated entities, `queries` call sites mixing the clauses a real query
 * does, then `definitions` decorated and `defined` entities from `defineEntity` declaring the same indexes, each read once.
 * The caller makes `uql-orm` resolve. Shared by `type-perf.ts`, `type-floor.ts` and `packages/orm/verify-dist.ts`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const entities = /*ts*/ `import { Entity, f, Field, idKey, ManyToOne, OneToMany } from 'uql-orm';
import { Settings, Tags } from './payloads.js';

@Entity() export class Company {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.number().nullable()) size?: number | null;
  @OneToMany({ entity: () => User, mappedBy: (u) => u.company }) users?: User[];
}
@Entity() export class User {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.string().nullable()) email?: string | null;
  @Field(f.number().nullable()) age?: number | null;
  @Field(f.date().nullable()) createdAt?: Date | null;
  @Field(f.references(() => Company).nullable()) companyId?: number | null;
  @ManyToOne({ entity: () => Company, references: (u) => u.companyId }) company?: Company;
}
@Entity() export class Membership {
  [idKey]?: 'userId' | 'companyId';
  @Field(f.number().id()) userId?: number;
  @Field(f.number().id()) companyId?: number;
}
@Entity() export class Seat {
  @Field(f.number().id()) id?: number;
  @Field(f.number().nullable()) memberUserId?: number | null;
  @Field(f.number().nullable()) memberCompanyId?: number | null;
  @ManyToOne({
    entity: () => Membership,
    references: (s, m) => [{ local: s.memberUserId, foreign: m.userId }, { local: s.memberCompanyId, foreign: m.companyId }],
  })
  member?: Membership;
}
`;

/** One block per call site, mixing the clauses a real query does: projection, filter, sort, relation, aggregate, returning. */
const block = (i: number) => /*ts*/ `
export async function q${i}(q: Querier) {
  const a = await q.findMany(User, { $select: { id: true, name: true }, $where: { age: { $gte: ${i} } }, $sort: { createdAt: -1 } });
  const b = await q.findOne(User, { $select: { email: false }, $where: { name: 'x' } });
  const c = await q.findMany(Company, { $populate: { users: { $select: { name: true } } }, $where: { size: ${i} } });
  await q.insertMany(User, [{ name: 'x', age: ${i} }]);
  const e = await q.insertOne(User, { name: 'x', age: ${i} }, { returning: { id: true, name: true } });
  await q.updateMany(User, { $where: { age: ${i} } }, { name: 'y' });
  const d = await q.aggregate(User, {
    $group: { name: true, companyName: { company: { name: true } } },
    $select: { n: { $count: '*', $where: { age: { $gt: ${i} } } }, total: { $sum: { age: true } } },
    $having: { n: { $gt: ${i} } },
    $sort: { total: -1 },
  });
  return [a[0]?.name, b?.name, c[0]?.users, d[0]?.companyName, e.name];
}`;

/** A composite index, an expression index and three JSON path indexes: one list, so both forms declare the same. */
const indexes = /*ts*/ `(row, index) => [
    index([row.name, { column: row.createdAt, order: 'desc' }]),
    index([sql\`lower(\${row.email})\`], { unique: true }),
    index([row.settings.theme]),
    index([{ column: row.settings.rating, type: Number }]),
    index([{ column: row.tags, type: [String], charLength: 64 }]),
  ]`;

/** A filter through the to-many, so each form's filters are weighed where they read a relation. */
const filters = /*ts*/ `{ parented: { where: { children: { parentId: { $ne: null } } }, default: false } }`;

/** A read through the entity's relation and aggregate, so each form's row is weighed where a query reads it. */
const read = (entity: string, i: number) => /*ts*/ `
export async function read${entity}${i}(q: Querier) {
  const rows = await q.findMany(${entity}${i}, {
    $select: { id: true, name: true, childCount: true },
    $where: { name: 'x' },
    $populate: { children: { $select: { parentId: true } } },
  });
  return rows[0]?.children[0]?.parentId;
}`;

/** One decorated entity per definition site: the indexes, the filters, and a to-many with its aggregate. */
const definition = (i: number) => /*ts*/ `
@Entity({ indexes: ${indexes}, filters: ${filters} })
export class Indexed${i} {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.string().nullable()) email?: string | null;
  @Field(f.date().nullable()) createdAt?: Date | null;
  @Field(f.json(Settings).nullable()) settings?: Json<{ theme: string; rating: number }> | null;
  @Field(f.json(Tags).nullable()) tags?: Json<string[]> | null;
  @OneToMany({ entity: () => Child${i}, mappedBy: (child) => child.parent }) children?: Child${i}[];
  @Computed((row) => row.children.count()) readonly childCount?: number;
}
@Entity() export class Child${i} {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Indexed${i}).nullable()) parentId?: number | null;
  @ManyToOne({ entity: () => Indexed${i}, references: (child) => child.parentId }) parent?: Indexed${i};
}
${read('Indexed', i)}`;

/** The same entity and indexes declared with `defineEntity`, its row derived, to weigh the two forms against each other. */
const definedEntity = (i: number) => /*ts*/ `
export const Defined${i} = defineEntity({
  name: 'Defined${i}',
  fields: {
    id: f.number().id(),
    name: f.string().nullable(),
    email: f.string().nullable(),
    createdAt: f.date().nullable(),
    settings: f.json(Settings).nullable(),
    tags: f.json(Tags).nullable(),
  },
})
  .indexes(${indexes})
  .relations(
    (rel) => ({ children: () => rel.oneToMany(DefinedChild${i}, { mappedBy: (child) => child.parent }) }),
    (agg) => ({ childCount: () => agg.children.count() }),
  )
  .filters(${filters});
export const DefinedChild${i} = defineEntity({
  name: 'DefinedChild${i}',
  fields: { id: f.number().id(), parentId: f.number().nullable() },
}).relations((rel) => ({ parent: () => rel.manyToOne(Defined${i}, { references: (child) => child.parentId }) }));
${read('Defined', i)}`;

/** How many of each block the project holds. */
export type FixtureSize = { readonly queries: number; readonly definitions: number; readonly defined: number };

const times = (count: number, write: (i: number) => string) => Array.from({ length: count }, (_, i) => write(i));

/** The project's sources by file name. */
function sources({ queries, definitions, defined }: FixtureSize): Record<string, string> {
  return {
    'entities.ts': entities,
    'payloads.ts': /*ts*/ `import type { StandardSchemaV1 } from 'uql-orm';
export declare const Settings: StandardSchemaV1<unknown, { theme: string; rating: number }>;
export declare const Tags: StandardSchemaV1<unknown, string[]>;
`,
    'calls.ts': [
      /*ts*/ `import type { Querier } from 'uql-orm';`,
      /*ts*/ `import { Company, User } from './entities.js';`,
      /*ts*/ `export type Fixture = [Querier, typeof Company, typeof User];`,
      ...times(queries, block),
    ].join('\n'),
    'definitions.ts': [
      /*ts*/ `import { Computed, Entity, f, Field, ManyToOne, OneToMany, sql, type Json, type Querier } from 'uql-orm';`,
      /*ts*/ `import { Settings, Tags } from './payloads.js';`,
      ...times(definitions, definition),
    ].join('\n'),
    'defined.ts': [
      /*ts*/ `import { defineEntity, f, sql, type Querier } from 'uql-orm';`,
      /*ts*/ `import { Settings, Tags } from './payloads.js';`,
      ...times(defined, definedEntity),
    ].join('\n'),
  };
}

/**
 * Writes the project into `dir`: the fixture's sources, `files` beside them, and a strict tsconfig with no
 * ambient types, `compilerOptions` added. Every `.ts` file in `dir` is compiled.
 */
export function writeConsumerProject(
  dir: string,
  size: FixtureSize,
  compilerOptions: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, string>> = {},
): void {
  const tsconfig = {
    compilerOptions: { strict: true, noEmit: true, types: [], ...compilerOptions },
    include: ['*.ts'],
  };
  const project = {
    'package.json': JSON.stringify({ type: 'module' }),
    'tsconfig.json': JSON.stringify(tsconfig),
    ...sources(size),
    ...files,
  };
  for (const [name, content] of Object.entries(project)) {
    writeFileSync(join(dir, name), content);
  }
}
