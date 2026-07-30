import { expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { Item } from '../test/entityMock.js';

/**
 * Key->column mapping has to hold on *every* read path, not just `$where`. Every fixture in the
 * dialect suites happens to name its columns after its properties, so a path that addressed the
 * property name looked correct until an entity renamed something - which is how MongoDB shipped a
 * `$select` that returned `undefined`, a `$sort` that did not order, a `$group` that collapsed every
 * row into one bucket, and a soft delete that never hid the row.
 */
@Entity({ name: 'renamed_row' })
class Renamed {
  @Id({ name: 'row_pk' })
  id?: number;
  @Field({ name: 'the_label' })
  label?: string;
  @Field({ name: 'deleted_at', softDelete: true })
  deletedAt?: Date;
}

const pgSql = (build: (dialect: PostgresDialect, ctx: ReturnType<PostgresDialect['createContext']>) => void) => {
  const dialect = new PostgresDialect();
  const ctx = dialect.createContext();
  build(dialect, ctx);
  return ctx.sql;
};

const mongo = new MongoDialect();

it('projects the stored column, never the property key', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, { $select: { label: true } }))).toContain('"the_label"');
  expect(mongo.select(Renamed, { label: true })).toEqual({ the_label: 1 });
});

it('sorts by the stored column', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, { $sort: { label: 'desc' } }))).toContain('ORDER BY "the_label" DESC');
  expect(mongo.sort(Renamed, { label: 'desc' })).toEqual({ the_label: -1 });
});

it('filters by the stored column', () => {
  expect(pgSql((d, ctx) => d.where(ctx, Renamed, { label: 'x' }))).toContain('"the_label" = ');
  expect(mongo.where(Renamed, { label: 'x' })).toMatchObject({ the_label: 'x' });
});

it('groups by the stored column while returning the caller key', () => {
  expect(pgSql((d, ctx) => d.aggregate(ctx, Renamed, { $group: { label: true }, $agg: { n: { $count: '*' } } }))) //
    .toContain('"the_label" "label"');
  expect(mongo.buildAggregateStages(Renamed, { $group: { label: true }, $agg: { n: { $count: '*' } } })).toEqual([
    { $group: { _id: { label: '$the_label' }, n: { $sum: 1 } } },
    { $project: { _id: 0, label: '$_id.label', n: 1 } },
  ]);
});

it('applies the soft-delete filter on the stored column', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, {}))).toContain('"deleted_at" IS NULL');
  expect(mongo.where(Renamed, {})).toEqual({ deleted_at: null });
});

it('rejects a relation $size mixed with other conditions on both engines', () => {
  // it used to fall through to field filtering and emit a condition on a `$size` *column*
  const mixed = { tags: { $size: 2, name: 'x' } };
  expect(() => pgSql((d, ctx) => d.where(ctx, Item, mixed as never))).toThrow(
    '$size on a relation cannot be combined with other conditions: name',
  );
  expect(() => mongo.whereWithRelations(Item, mixed as never)).toThrow(
    '$size on a relation cannot be combined with other conditions: name',
  );
});

it('addresses the primary key as each engine stores it', () => {
  expect(pgSql((d, ctx) => d.where(ctx, Renamed, { id: 1 }))).toContain('"row_pk" = ');
  // MongoDB always stores it as `_id`, whatever the column is named
  expect(mongo.where(Renamed, { id: 1 })).toMatchObject({ _id: 1 });
  expect(mongo.sort(Renamed, { id: 1 })).toEqual({ _id: 1 });
});
