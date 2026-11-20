/**
 * A view is declared as a query over its source, and typed by it: its row is what the query answers, its key what keeps
 * a row unique, and no write takes it. Type-checked by `bun run ts` only.
 */
import { defineEntity, defineView, Entity, f, Field } from '../entity/index.js';
import type { IdKey, Querier } from '../index.js';

const Workspace = defineEntity({ name: 'Workspace', fields: { id: f.number().autoIncrement(), name: f.string() } });

const Resource = defineEntity({
  name: 'Resource',
  fields: {
    id: f.number().autoIncrement(),
    workspaceId: f.number(),
    label: f.string().nullable(),
    bytes: f.bigint(),
    published: f.boolean(),
  },
});

/** Exported, so its declaration is emitted: a view's type must name everything it uses. */
export const Usage = defineView({
  name: 'Usage',
  from: () => Resource,
  aggregate: { $group: { workspaceId: true }, $select: { total: { $count: '*' }, size: { $sum: { bytes: true } } } },
}).relations((rel) => ({
  workspace: () => rel.manyToOne(Workspace, { references: (usage) => usage.workspaceId }),
}));

const ByLabel = defineView({
  name: 'ByLabel',
  from: () => Resource,
  aggregate: { $group: { label: true }, $select: { total: { $count: '*' } } },
});

const Published = defineView({
  name: 'Published',
  from: () => Resource,
  find: { $select: { id: true, label: true }, $where: { published: true } },
});

const Labels = defineView({ name: 'Labels', from: () => Resource, find: { $select: { label: true } } });

declare const querier: Querier;

export async function anAggregateViewReadsAsItsQueryAnswers(): Promise<unknown[]> {
  const rows: { workspaceId: number; total: number; size: bigint | null }[] = await querier.findMany(Usage, {});
  const one = await querier.findOneById(Usage, 1);
  const populated = await querier.findMany(Usage, { $populate: { workspace: { $select: { name: true } } } });
  const name: string | undefined = populated[0]?.workspace?.name;
  return [rows, one, name];
}

export async function aFindViewReadsTheFieldsItSelects(): Promise<unknown[]> {
  const rows: { id: number; label?: string | null }[] = await querier.findMany(Published, {});
  const one = await querier.findOneById(Published, 1);
  // @ts-expect-error a field the view does not select is not one of its columns
  await querier.findMany(Published, { $where: { bytes: 1n } });
  return [rows, one];
}

export function itsKeyIsWhatKeepsARowUnique() {
  const grouped: IdKey<InstanceType<typeof Usage>> = 'workspaceId';
  const found: IdKey<InstanceType<typeof Published>> = 'id';
  // @ts-expect-error a nullable group is no key: NULL groups are not unique
  const nullable: IdKey<InstanceType<typeof ByLabel>> = 'nope';
  // @ts-expect-error a find leaving its source's key out has none
  const unkeyed: IdKey<InstanceType<typeof Labels>> = 'nope';
  return [grouped, found, nullable, unkeyed];
}

export async function aViewTakesNoWrite() {
  // @ts-expect-error a view is not inserted
  await querier.insertOne(Usage, { workspaceId: 1, total: 1, size: 1n });
  // @ts-expect-error nor updated
  await querier.updateMany(Published, { $where: { id: 1 } }, { label: 'a' });
  // @ts-expect-error nor deleted
  await querier.deleteOneById(Published, 1);
}

export function itsQueryIsCheckedAsItsMethodChecksIt() {
  defineView({
    name: 'TypoGroup',
    from: () => Resource,
    // @ts-expect-error a group naming no field of its source
    aggregate: { $group: { workspaceID: true }, $select: { total: { $count: '*' } } },
  });
  defineView({
    name: 'TypoFind',
    from: () => Resource,
    // @ts-expect-error a find selecting no field of its source
    find: { $select: { lable: true } },
  });
  defineView({
    name: 'Both',
    from: () => Resource,
    // @ts-expect-error a view takes one query: an aggregate or a find
    aggregate: { $select: { total: { $count: '*' } } },
    find: { $select: { label: true } },
  });
}

export function aViewSortsOnlyToTakeItsTopRows() {
  defineView({
    name: 'TopFind',
    from: () => Resource,
    find: { $select: { id: true, bytes: true }, $sort: { bytes: 'desc' }, $limit: 10 },
  });
  defineView({
    name: 'TopAggregate',
    from: () => Resource,
    aggregate: {
      $group: { workspaceId: true },
      $select: { total: { $count: '*' } },
      $sort: { total: 'desc' },
      $limit: 3,
      $skip: 1,
    },
    materialized: true,
  });
  defineView({
    name: 'SortedFind',
    from: () => Resource,
    // @ts-expect-error a sort alone orders nothing in a set of rows: a read orders a view's
    find: { $select: { label: true }, $sort: { label: 'asc' } },
  });
  defineView({
    name: 'PagedFind',
    from: () => Resource,
    // @ts-expect-error nor does a limit take rows in any order of its own
    find: { $select: { label: true }, $limit: 10 },
  });
  defineView({
    name: 'SortedAggregate',
    from: () => Resource,
    // @ts-expect-error an aggregate view neither
    aggregate: { $group: { workspaceId: true }, $select: { total: { $count: '*' } }, $sort: { total: 'desc' } },
  });
  defineView({
    name: 'PagedAggregate',
    from: () => Resource,
    // @ts-expect-error nor a page of one
    aggregate: { $group: { workspaceId: true }, $select: { total: { $count: '*' } }, $skip: 1 },
  });
}

export function aViewTakesTheSectionsAViewHas() {
  defineView({ name: 'Sectioned', from: () => Resource, find: { $select: { id: true } } })
    .filters({ live: { where: { id: { $gt: 0 } } } })
    .policies([{ allow: {} }]);
  // @ts-expect-error a view has no indexes: it has no rows of its own to index
  defineView({ name: 'Indexed', from: () => Resource, find: { $select: { id: true } } }).indexes(() => []);
  // @ts-expect-error a view has no hooks: nothing writes it
  defineView({ name: 'Hooked', from: () => Resource, find: { $select: { id: true } } }).hooks({});
}

export function aMaterializedViewIsATableItsQueryRefreshes() {
  const Stored = defineView({
    name: 'StoredUsage',
    from: () => Resource,
    aggregate: { $group: { workspaceId: true }, $select: { total: { $count: '*' } } },
    materialized: true,
  }).indexes((row, index) => [index([row.total])]);
  // @ts-expect-error its sections are each declared once
  Stored.indexes((row, index) => [index([row.total])]);
}

@Entity()
class Ledger {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number()) accountId!: number;
  @Field(f.number()) amount!: number;
}

export async function aViewReadsADecoratedSourceAsADefinedOne(): Promise<unknown[]> {
  const Balances = defineView({
    name: 'Balances',
    from: () => Ledger,
    aggregate: { $group: { accountId: true }, $select: { balance: { $sum: { amount: true } } } },
  });
  const rows: { accountId: number; balance: number | null }[] = await querier.findMany(Balances, {});
  const keyed: IdKey<InstanceType<typeof Balances>> = 'accountId';
  defineView({
    name: 'TypoLedger',
    from: () => Ledger,
    // @ts-expect-error a group naming no field of its decorated source
    aggregate: { $group: { acountId: true }, $select: { total: { $count: '*' } } },
  });
  return [rows, keyed];
}
