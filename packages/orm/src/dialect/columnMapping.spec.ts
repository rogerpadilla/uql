import { expect, it } from 'vitest';
import { Entity, f, Field } from '../entity/index.js';
import { MongoDialect } from '../mongodb/mongoDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { Item } from '../test/entityMock.js';

/**
 * Key-to-column mapping holds on every read path, not just `$where`: the other fixtures name columns
 * after their properties, so only a renamed column shows a path addressing the property instead.
 */
@Entity({ name: 'renamed_row' })
class Renamed {
  @Field(f.number().id().name('row_pk'))
  id?: number;
  @Field(f.string().nullable().name('the_label'))
  label?: string | null;
  @Field(f.date().nullable().softDelete().name('deleted_at'))
  deletedAt?: Date | null;
}

const pgSql = (build: (dialect: PostgresDialect, ctx: ReturnType<PostgresDialect['createContext']>) => void) => {
  const dialect = new PostgresDialect();
  const ctx = dialect.createContext();
  build(dialect, ctx);
  return ctx.sql;
};

const mongo = new MongoDialect();

it('should project the stored column, never the property key', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, { $select: { label: true } }))).toContain('"the_label"');
  expect(mongo.select(Renamed, { label: true })).toEqual({ the_label: 1, _id: 0 });
});

it('should sort by the stored column', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, { $sort: { label: 'desc' } }))).toContain('ORDER BY "the_label" DESC');
  expect(mongo.readPlan(Renamed, { $sort: { label: 'desc' } })).toEqual({ sort: { the_label: -1 } });
});

it('should filter by the stored column', () => {
  expect(pgSql((d, ctx) => d.where(ctx, Renamed, { label: 'x' }))).toContain('"the_label" = ');
  expect(mongo.where(Renamed, { label: 'x' })).toMatchObject({ the_label: 'x' });
});

it('should group by the stored column while returning the caller key', () => {
  expect(pgSql((d, ctx) => d.aggregate(ctx, Renamed, { $group: { label: true }, $select: { n: { $count: '*' } } }))) //
    .toContain('"the_label" "label"');
  expect(mongo.buildAggregateStages(Renamed, { $group: { label: true }, $select: { n: { $count: '*' } } })).toEqual([
    { $match: { deleted_at: null } },
    { $group: { _id: { label: '$the_label' }, n: { $sum: 1 } } },
    { $project: { _id: 0, label: '$_id.label', n: 1 } },
  ]);
});

it('should apply the soft-delete filter on the stored column', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, {}))).toContain('"deleted_at" IS NULL');
  expect(mongo.where(Renamed, {})).toEqual({ deleted_at: null });
});

it('should reject a relation $size mixed with other conditions on both engines', () => {
  const mixed = { tags: { $size: 2, name: 'x' } };
  // @ts-expect-error: the types refuse the mix first, and plain JavaScript reaches the dialect past them
  expect(() => pgSql((d, ctx) => d.where(ctx, Item, mixed))).toThrow(
    '$size on a relation cannot be combined with other conditions: name',
  );
  // @ts-expect-error: as above
  expect(() => mongo.matchStages(Item, mixed)).toThrow(
    '$size on a relation cannot be combined with other conditions: name',
  );
});

it('should address the primary key as each engine stores it', () => {
  expect(pgSql((d, ctx) => d.where(ctx, Renamed, { id: 1 }))).toContain('"row_pk" = ');
  // MongoDB always stores it as `_id`, whatever the column is named
  expect(mongo.where(Renamed, { id: 1 })).toMatchObject({ _id: 1 });
  expect(mongo.readPlan(Renamed, { $sort: { id: 1 } })).toEqual({ sort: { _id: 1 } });
});
