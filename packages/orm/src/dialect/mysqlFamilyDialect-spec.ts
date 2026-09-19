import { expect } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { JsonRecord, User } from '../test/index.js';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec.js';

/**
 * The JSON operator tests MySQL and MariaDB render alike, save for what each dialect spells its own way:
 * a value read as JSON (`jsonCastText`: `CAST(v AS JSON)` vs `JSON_EXTRACT(v, '$')`), a path of an array
 * element (`elemPath`: `->>` vs `JSON_VALUE`), and how an `$elemMatch` subquery opens (`elemSelect`,
 * which MySQL hints).
 */
export abstract class MySqlFamilySpec extends AbstractSqlDialectSpec {
  /** MySQL and MariaDB have no `NULLS FIRST`, so the placement is a leading term of its own. */
  protected override expectedNullsOrdering(column: string): string {
    return `${column} IS NOT NULL, ${column} DESC`;
  }

  protected abstract jsonCastText(operand: string): string;

  /** A field of the exploded element, as text or, with `json`, as the JSON value. */
  protected abstract elemPath(field: string, json?: boolean): string;

  protected abstract readonly elemSelect: string;

  /** The `FROM` every `$elemMatch` reads its elements through. */
  private readonly elemFrom = "JSON_TABLE(`entries`, '$[*]' COLUMNS (v JSON PATH '$')) AS _uql_elem";

  /** Backslash quoting, and a boolean stored as an integer. */
  protected override inlineLiterals() {
    return { quoted: "'it\\'s'", truth: '1' };
  }

  /** InnoDB's own estimate, off the connection's database where the entity names no schema. */
  override shouldEstimatedCount() {
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, User));
    expect(sql).toBe(
      'SELECT TABLE_ROWS `_uql_value` FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    );
    expect(values).toEqual(['User']);
  }

  /** A schema the entity names is bound where the connection's own database would be. */
  shouldEstimateTheCountInTheSchemaTheEntityNames() {
    @Entity({ schema: 'crm' })
    class Ledger {
      @Id({ type: Number }) id?: number;
    }
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, Ledger));
    expect(sql).toBe(
      'SELECT TABLE_ROWS `_uql_value` FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    );
    expect(values).toEqual(['crm', 'Ledger']);
  }

  /** With no `$fields`, the search runs over exactly the columns the `FULLTEXT` index `MATCH` needs covers. */
  shouldSearchTheFulltextIndexWhereTextNamesNoFields() {
    @Entity()
    @Index((listing) => [listing.name, listing.description], { type: 'fulltext' })
    class Listing {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) name?: string | null;
      @Field({ type: String }) description?: string | null;
    }
    const { sql, values } = this.exec((ctx) => this.dialect.where(ctx, Listing, { $text: { $value: 'lamp' } }));
    expect(sql).toBe(' WHERE MATCH(`name`, `description`) AGAINST(?)');
    expect(values).toEqual(['lamp']);
  }

  /** A heavier column's own `MATCH` reads the one-column `FULLTEXT` index a weighted index declares for it. */
  shouldRankByAWeightedFulltextIndex() {
    @Entity()
    @Index((listing) => [{ column: listing.name, weight: 3 }, listing.description], { type: 'fulltext' })
    class Listing {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) name?: string | null;
      @Field({ type: String }) description?: string | null;
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Listing, {
        $select: { id: true },
        $where: { $text: { $value: 'lamp' } },
        $sort: { $text: 'desc' },
      }),
    );
    expect(sql).toBe(
      'SELECT `id` FROM `Listing` WHERE MATCH(`name`, `description`) AGAINST(?) ORDER BY (1 * MATCH(`name`, `description`) AGAINST(?) + 2 * MATCH(`name`) AGAINST(?)) DESC',
    );
    expect(values).toEqual(['lamp', 'lamp', 'lamp']);
  }

  /** InnoDB runs `FOR UPDATE` beside a window function, so a locked paged read stays one statement. */
  shouldRunAWindowUnderARowLock() {
    expect(this.dialect.features.rowLockWithWindow).toBe(true);
  }

  shouldHandleDate() {
    const ctx = this.dialect.createContext();
    expect(this.dialect.addValue(ctx, new Date())).toBe('?');
    expect(ctx.values).toHaveLength(1);
    expect(ctx.values[0]).toBeInstanceOf(Date);
  }

  shouldEscape() {
    expect(this.dialect.escape("va'lue")).toBe("'va\\'lue'");
  }

  shouldHandleOtherValues() {
    const ctx = this.dialect.createContext();
    expect(this.dialect.addValue(ctx, 123)).toBe('?');
    expect(ctx.values[0]).toBe(123);
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
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE CASE WHEN JSON_TYPE(`entries`) = 'ARRAY' THEN JSON_LENGTH(`entries`) END = ?",
    );
    expect(ctx.values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    // Single comparison operator
    let ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: { $gte: 2 } } },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE CASE WHEN JSON_TYPE(`entries`) = 'ARRAY' THEN JSON_LENGTH(`entries`) END >= ?",
    );
    expect(ctx.values).toEqual([2]);

    // Multiple comparison operators
    ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: { $gt: 0, $lte: 5 } } },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE (CASE WHEN JSON_TYPE(`entries`) = 'ARRAY' THEN JSON_LENGTH(`entries`) END > ? AND CASE WHEN JSON_TYPE(`entries`) = 'ARRAY' THEN JSON_LENGTH(`entries`) END <= ?)",
    );
    expect(ctx.values).toEqual([0, 5]);

    // $between
    ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $size: { $between: [1, 10] } } },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE CASE WHEN JSON_TYPE(`entries`) = 'ARRAY' THEN JSON_LENGTH(`entries`) END BETWEEN ? AND ?",
    );
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
      `SELECT \`id\` FROM \`JsonRecord\` WHERE EXISTS (${this.elemSelect} FROM ${this.elemFrom} WHERE ${this.elemPath('city')} LIKE ?)`,
    );
    expect(ctx.values).toEqual(['New%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, JsonRecord, {
      $select: { id: true },
      $where: { entries: { $elemMatch: { price: { $gte: 50 }, active: { $ne: false } } } },
    });
    expect(ctx.sql).toContain(`EXISTS (${this.elemSelect} FROM ${this.elemFrom}`);
    expect(ctx.sql).toContain(`CAST(${this.elemPath('price')} AS DOUBLE) >= CAST(? AS DOUBLE)`);
    expect(ctx.sql).toContain(`NOT (${this.elemPath('active', true)} <=> ${this.jsonCastText('?')})`);
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
    expect(ctx.sql).toContain(`${this.elemPath('a')} = ?`);
    expect(ctx.sql).toContain(`CAST(${this.elemPath('b')} AS DOUBLE) > CAST(? AS DOUBLE)`);
    expect(ctx.sql).toContain(`CAST(${this.elemPath('c')} AS DOUBLE) < CAST(? AS DOUBLE)`);
    expect(ctx.sql).toContain(`CAST(${this.elemPath('d')} AS DOUBLE) <= CAST(? AS DOUBLE)`);
    expect(ctx.sql).toContain(`${this.elemPath('e')} LIKE ?`);
    // A JSON path folds case exactly as a column does: both sides, never the pattern alone.
    expect(ctx.sql).toContain(`LOWER(${this.elemPath('f')}) LIKE ?`);
    expect(ctx.values).toContain('hi');
    expect(ctx.sql).toContain(`${this.elemPath('m')} REGEXP ?`);
    expect(ctx.sql).toContain(`CAST(${this.elemPath('n')} AS DOUBLE) IN (`);
    expect(ctx.sql).toContain(`CAST(${this.elemPath('o')} AS DOUBLE) NOT IN (`);
  }
}
