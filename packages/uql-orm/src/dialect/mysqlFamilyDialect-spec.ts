import { expect } from 'vitest';
import { JsonRecord, User } from '../test/index.js';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec.js';

/**
 * The seven JSON operator tests MySQL and MariaDB render byte-for-byte identically, save for how a
 * JSON value is read back for a boolean comparison - `jsonCastText`, which each dialect exposes to
 * match its own `AbstractSqlDialect.jsonCast` override (`CAST(v AS JSON)` vs `JSON_EXTRACT(v, '$')`).
 */
export abstract class MySqlFamilySpec extends AbstractSqlDialectSpec {
  protected abstract jsonCastText(operand: string): string;

  /** 2^64-1, the count MySQL's manual gives for "every row from the offset on". */
  protected override expected$skipClause(): string {
    return 'LIMIT 18446744073709551615 OFFSET 30';
  }

  /** InnoDB's own estimate, off the connection's database where the entity names no schema. */
  override shouldEstimatedCount() {
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, User));
    expect(sql).toBe(
      'SELECT TABLE_ROWS `count` FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    );
    expect(values).toEqual(['User']);
  }

  shouldHandleDate() {
    const values: unknown[] = [];
    expect(this.dialect.addValue(values, new Date())).toBe('?');
    expect(values).toHaveLength(1);
    expect(values[0]).toBeInstanceOf(Date);
  }

  shouldEscape() {
    expect(this.dialect.escape("va'lue")).toBe("'va\\'lue'");
  }

  shouldHandleOtherValues() {
    const values: unknown[] = [];
    expect(this.dialect.addValue(values, 123)).toBe('?');
    expect(values[0]).toBe(123);
  }

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
      "SELECT `id` FROM `JsonRecord` WHERE EXISTS (SELECT 1 FROM JSON_TABLE(`entries`, '$[*]' COLUMNS (`city` TEXT PATH '$.city')) AS _uql_elem_1 WHERE _uql_elem_1.`city` LIKE ?)",
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
    expect(ctx.sql).toContain('CAST(_uql_elem_1.`price` AS DECIMAL) >= ?');
    expect(ctx.sql).toContain(`NOT (${this.jsonCastText('_uql_elem_1.`active`')} <=> ${this.jsonCastText('?')})`);
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
    expect(ctx.sql).toContain('_uql_elem_1.`a` = ?');
    expect(ctx.sql).toContain('CAST(_uql_elem_1.`b` AS DECIMAL) > ?');
    expect(ctx.sql).toContain('CAST(_uql_elem_1.`c` AS DECIMAL) < ?');
    expect(ctx.sql).toContain('CAST(_uql_elem_1.`d` AS DECIMAL) <= ?');
    expect(ctx.sql).toContain('_uql_elem_1.`e` LIKE ?');
    // A JSON path folds case exactly as a column does: both sides, never the pattern alone.
    expect(ctx.sql).toContain('LOWER(_uql_elem_1.`f`) LIKE ?');
    expect(ctx.values).toContain('hi');
    expect(ctx.sql).toContain('_uql_elem_1.`m` REGEXP ?');
    expect(ctx.sql).toContain('CAST(_uql_elem_1.`n` AS DECIMAL) IN (');
    expect(ctx.sql).toContain('CAST(_uql_elem_1.`o` AS DECIMAL) NOT IN (');
  }
}
