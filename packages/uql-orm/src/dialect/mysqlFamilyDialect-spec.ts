import { expect } from 'vitest';
import { JsonRecord } from '../test/index.js';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec.js';

/**
 * The seven JSON operator tests MySQL and MariaDB render byte-for-byte identically, save for how a
 * JSON value is read back for a boolean comparison - `jsonCastText`, which each dialect exposes to
 * match its own `AbstractSqlDialect.jsonCast` override (`CAST(v AS JSON)` vs `JSON_EXTRACT(v, '$')`).
 */
export abstract class MySqlFamilySpec extends AbstractSqlDialectSpec {
  protected abstract jsonCastText(operand: string): string;

  shouldFind$elemMatch() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $elemMatch: { city: 'NYC' } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `JsonRecord` WHERE JSON_CONTAINS(`entries`, ?)');
    expect(ctx.values).toEqual(['[{"city":"NYC"}]']);
  }

  shouldFind$all() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $all: ['admin', 'user'] } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `JsonRecord` WHERE JSON_CONTAINS(`entries`, ?)');
    expect(ctx.values).toEqual(['["admin","user"]']);
  }

  shouldFind$size() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: 3 } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `JsonRecord` WHERE JSON_LENGTH(`entries`) = ?');
    expect(ctx.values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    // Single comparison operator
    let ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: { $gte: 2 } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `JsonRecord` WHERE JSON_LENGTH(`entries`) >= ?');
    expect(ctx.values).toEqual([2]);

    // Multiple comparison operators
    ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: { $gt: 0, $lte: 5 } } },
    });
    expect(ctx.sql).toBe(
      'SELECT `id` FROM `JsonRecord` WHERE (JSON_LENGTH(`entries`) > ? AND JSON_LENGTH(`entries`) <= ?)',
    );
    expect(ctx.values).toEqual([0, 5]);

    // $between
    ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: { $between: [1, 10] } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `JsonRecord` WHERE JSON_LENGTH(`entries`) BETWEEN ? AND ?');
    expect(ctx.values).toEqual([1, 10]);
  }

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $elemMatch: { city: { $like: 'New%' } } } },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE EXISTS (SELECT 1 FROM JSON_TABLE(`entries`, '$[*]' COLUMNS (`city` TEXT PATH '$.city')) AS jt WHERE jt.`city` LIKE ?)",
    );
    expect(ctx.values).toEqual(['New%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $elemMatch: { price: { $gte: 50 }, active: { $ne: false } } } },
    });
    expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM JSON_TABLE');
    expect(ctx.sql).toContain('CAST(jt.`price` AS DECIMAL) >= ?');
    expect(ctx.sql).toContain(`NOT (${this.jsonCastText('jt.`active`')} <=> ${this.jsonCastText('?')})`);
  }

  shouldFind$elemMatchWithAllOperators() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: {
        entries: {
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
    expect(ctx.sql).toContain('jt.`a` = ?');
    expect(ctx.sql).toContain('CAST(jt.`b` AS DECIMAL) > ?');
    expect(ctx.sql).toContain('CAST(jt.`c` AS DECIMAL) < ?');
    expect(ctx.sql).toContain('CAST(jt.`d` AS DECIMAL) <= ?');
    expect(ctx.sql).toContain('jt.`e` LIKE ?');
    expect(ctx.sql).toContain('jt.`f` LIKE ?');
    expect(ctx.sql).toContain('jt.`m` REGEXP ?');
    expect(ctx.sql).toContain('CAST(jt.`n` AS DECIMAL) IN (');
    expect(ctx.sql).toContain('CAST(jt.`o` AS DECIMAL) NOT IN (');
  }
}
