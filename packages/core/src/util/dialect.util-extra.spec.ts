import { describe, expect, it } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { InventoryAdjustment, Item, ItemAdjustment, User } from '../test/index.js';
import { raw } from './raw.js';

describe('Query with $exists and nested relation filtering', () => {
  const dialect = new PostgresDialect();

  const exec = (fn: (ctx: ReturnType<typeof dialect.createContext>) => void) => {
    const ctx = dialect.createContext();
    fn(ctx);
    return { sql: ctx.sql, values: ctx.values };
  };

  it('should generate $exists sub-query with raw callback', () => {
    const { sql, values } = exec((ctx) =>
      dialect.find(ctx, Item, {
        $select: { id: true, name: true },
        $where: {
          $exists: raw(({ ctx, dialect, escapedPrefix }) => {
            dialect.find(
              ctx,
              User,
              {
                $select: { id: true },
                $where: {
                  companyId: raw(({ ctx }) => void ctx.append(`${escapedPrefix}"companyId"`)),
                },
              },
              { autoPrefix: true },
            );
          }),
        },
      }),
    );

    expect(sql).toBe(
      'SELECT "id", "name" FROM "Item" WHERE EXISTS (SELECT "User"."id" FROM "User" WHERE "User"."companyId" = "Item"."companyId")',
    );
    expect(values).toEqual([]);
  });

  it('should generate $nexists sub-query with raw callback', () => {
    const { sql, values } = exec((ctx) =>
      dialect.find(ctx, Item, {
        $select: { id: true },
        $where: {
          $nexists: raw(({ ctx, dialect, escapedPrefix }) => {
            dialect.find(
              ctx,
              User,
              {
                $select: { id: true },
                $where: {
                  companyId: raw(({ ctx }) => void ctx.append(`${escapedPrefix}"companyId"`)),
                },
              },
              { autoPrefix: true },
            );
          }),
        },
      }),
    );

    expect(sql).toBe(
      'SELECT "id" FROM "Item" WHERE NOT EXISTS (SELECT "User"."id" FROM "User" WHERE "User"."companyId" = "Item"."companyId")',
    );
    expect(values).toEqual([]);
  });

  it('should generate nested $select with $where on OneToMany relation', () => {
    const { sql, values } = exec((ctx) =>
      dialect.find(ctx, InventoryAdjustment, {
        $select: {
          id: true,
          description: true,
          itemAdjustments: {
            $select: ['buyPrice', 'number'],
            $where: {
              buyPrice: { $gte: 100 },
            },
          },
        },
        $where: {
          createdAt: { $gte: 1000 },
        },
      }),
    );

    // Main query selects from InventoryAdjustment
    expect(sql).toBe(
      'SELECT "InventoryAdjustment"."id", "InventoryAdjustment"."description" FROM "InventoryAdjustment" WHERE "InventoryAdjustment"."createdAt" >= $1',
    );
    expect(values).toEqual([1000]);
  });

  it('should combine $exists with nested relation filtering', () => {
    // This demonstrates the corrected version of the user's query pattern
    const { sql, values } = exec((ctx) =>
      dialect.find(ctx, InventoryAdjustment, {
        $select: {
          id: true,
          description: true,
        },
        $where: {
          createdAt: { $gte: 1000 },
          $exists: raw(({ ctx, dialect, escapedPrefix }) => {
            dialect.find(
              ctx,
              ItemAdjustment,
              {
                $select: { id: true },
                $where: {
                  inventoryAdjustmentId: raw(({ ctx }) => void ctx.append(`${escapedPrefix}"id"`)),
                  buyPrice: { $gte: 100 },
                },
              },
              { autoPrefix: true },
            );
          }),
        },
      }),
    );

    expect(sql).toBe(
      'SELECT "id", "description" FROM "InventoryAdjustment" ' +
        'WHERE "createdAt" >= $1 AND EXISTS (SELECT "ItemAdjustment"."id" FROM "ItemAdjustment" ' +
        'WHERE "ItemAdjustment"."inventoryAdjustmentId" = "InventoryAdjustment"."id" AND "ItemAdjustment"."buyPrice" >= $2)',
    );
    expect(values).toEqual([1000, 100]);
  });

  it('should handle $gte operator in nested relation $where', () => {
    const { sql, values } = exec((ctx) =>
      dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
          tax: {
            $select: ['name', 'percentage'],
            $where: {
              percentage: { $gte: 10 },
            },
          },
        },
        $where: {
          salePrice: { $gte: 50 },
        },
      }),
    );

    // The related tax is fetched via JOIN with its filter applied in the JOIN condition
    expect(sql).toBe(
      'SELECT "Item"."id", "Item"."name", "tax"."id" "tax_id", "tax"."name" "tax_name", "tax"."percentage" "tax_percentage" ' +
        'FROM "Item" LEFT JOIN "Tax" "tax" ON "tax"."id" = "Item"."taxId" AND "tax"."percentage" >= $1 ' +
        'WHERE "Item"."salePrice" >= $2',
    );
    expect(values).toEqual([10, 50]);
  });
});
