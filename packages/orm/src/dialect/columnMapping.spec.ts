import { expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { Item } from '../test/entityMock.js';

/**
 * Key-to-column mapping holds on every read path, not just `$where`: the other fixtures name columns
 * after their properties, so only a renamed column shows a path addressing the property instead.
 */
@Entity({ name: 'renamed_row' })
class Renamed {
  @Id({ type: Number, name: 'row_pk' })
  id?: number;
  @Field({ type: String, name: 'the_label' })
  label?: string | null;
  @Field({ type: Date, name: 'deleted_at', softDelete: true })
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
  expect(mongo.select(Renamed, { label: true })).toEqual({ the_label: 1 });
});

it('should sort by the stored column', () => {
  expect(pgSql((d, ctx) => d.find(ctx, Renamed, { $sort: { label: 'desc' } }))).toContain('ORDER BY "the_label" DESC');
  expect(mongo.sort(Renamed, { label: 'desc' })).toEqual({ the_label: -1 });
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
  expect(() => pgSql((d, ctx) => d.where(ctx, Item, mixed))).toThrow(
    '$size on a relation cannot be combined with other conditions: name',
  );
  expect(() => mongo.matchStages(Item, mixed)).toThrow(
    '$size on a relation cannot be combined with other conditions: name',
  );
});

it('should address the primary key as each engine stores it', () => {
  expect(pgSql((d, ctx) => d.where(ctx, Renamed, { id: 1 }))).toContain('"row_pk" = ');
  // MongoDB always stores it as `_id`, whatever the column is named
  expect(mongo.where(Renamed, { id: 1 })).toMatchObject({ _id: 1 });
  expect(mongo.sort(Renamed, { id: 1 })).toEqual({ _id: 1 });
});
