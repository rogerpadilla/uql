import { expect } from 'vitest';
import { AbstractSqlDialectSpec } from '../dialect/abstractSqlDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { createSpec, User } from '../test/index.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }

  shouldThrowForVectorSort() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, VectorItem, {
          $select: { id: true },
          $sort: { vec: { $vector: [1, 2, 3] } },
          $limit: 10,
        }),
      ),
    ).toThrow('Vector similarity sort is not supported by this dialect');
  }

  shouldGetBeginTransactionStatementsWithIsolationLevel() {
    // MySQL uses 'set-before' strategy — two separate statements
    expect(this.dialect.getBeginTransactionStatements('read committed')).toEqual([
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'START TRANSACTION',
    ]);
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual([
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
      'START TRANSACTION',
    ]);
  }

  shouldHandleDate() {
    const dialect = new MySqlDialect();
    const values: unknown[] = [];
    expect(dialect.addValue(values, new Date())).toBe('?');
    expect(values).toHaveLength(1);
    expect(values[0]).toBeInstanceOf(Date);
  }

  shouldEscape() {
    const dialect = new MySqlDialect();
    expect(dialect.escape("va'lue")).toBe("'va\\'lue'");
  }

  shouldHandleOtherValues() {
    const dialect = new MySqlDialect();
    const values: unknown[] = [];
    expect(dialect.addValue(values, 123)).toBe('?');
    expect(values[0]).toBe(123);
  }

  // JSON operator tests
  shouldFind$elemMatch() {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $elemMatch: { city: 'NYC' } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_CONTAINS(`name`, ?)');
    expect(ctx.values).toEqual(['[{"city":"NYC"}]']);
  }

  shouldFind$all() {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $all: ['admin', 'user'] } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_CONTAINS(`name`, ?)');
    expect(ctx.values).toEqual(['["admin","user"]']);
  }

  shouldFind$size() {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: 3 } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_LENGTH(`name`) = ?');
    expect(ctx.values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    const dialect = new MySqlDialect();

    // Single comparison operator
    let ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: { $gte: 2 } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_LENGTH(`name`) >= ?');
    expect(ctx.values).toEqual([2]);

    // Multiple comparison operators
    ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: { $gt: 0, $lte: 5 } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE (JSON_LENGTH(`name`) > ? AND JSON_LENGTH(`name`) <= ?)');
    expect(ctx.values).toEqual([0, 5]);

    // $between
    ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: { $between: [1, 10] } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_LENGTH(`name`) BETWEEN ? AND ?');
    expect(ctx.values).toEqual([1, 10]);
  }

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $elemMatch: { city: { $like: 'New%' } } } },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `User` WHERE EXISTS (SELECT 1 FROM JSON_TABLE(`name`, '$[*]' COLUMNS (city TEXT PATH '$.city')) AS jt WHERE jt.city LIKE ?)",
    );
    expect(ctx.values).toEqual(['New%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $elemMatch: { price: { $gte: 50 }, active: { $ne: false } } } },
    });
    expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM JSON_TABLE');
    expect(ctx.sql).toContain('CAST(jt.price AS DECIMAL) >= ?');
    expect(ctx.sql).toContain('jt.active <> ?');
  }

  shouldFind$elemMatchWithAllOperators() {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: {
        name: {
          $elemMatch: {
            a: { $eq: 'x' },
            b: { $gt: 5 },
            c: { $lt: 10 },
            d: { $lte: 20 },
            e: { $like: '%test%' },
            f: { $ilike: 'HI' },
            g: { $startsWith: 'abc' },
            h: { $istartsWith: 'ABC' },
            i: { $endsWith: 'xyz' },
            j: { $iendsWith: 'XYZ' },
            k: { $includes: 'mid' },
            l: { $iincludes: 'MID' },
            m: { $regex: '^A' },
            n: { $in: [1, 2] },
            o: { $nin: [3, 4] },
          },
        },
      },
    });
    expect(ctx.sql).toContain('jt.a = ?');
    expect(ctx.sql).toContain('CAST(jt.b AS DECIMAL) > ?');
    expect(ctx.sql).toContain('CAST(jt.c AS DECIMAL) < ?');
    expect(ctx.sql).toContain('CAST(jt.d AS DECIMAL) <= ?');
    expect(ctx.sql).toContain('jt.e LIKE ?');
    expect(ctx.sql).toContain('jt.f LIKE ?');
    expect(ctx.sql).toContain('jt.m REGEXP ?');
    expect(ctx.sql).toContain('jt.n IN (');
    expect(ctx.sql).toContain('jt.o NOT IN (');
  }
}

createSpec(new MySqlDialectSpec());
