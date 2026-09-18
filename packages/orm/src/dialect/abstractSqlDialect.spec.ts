import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToOne } from '../entity/index.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';
import { Company, Item, ItemAdjustment, MeasureUnitCategory, Tax, User, VectorItem } from '../test/index.js';
import type { QueryContext, SqlDialectFeatures, SqlDialectName } from '../type/index.js';
import { entitySql, raw, refs } from '../util/index.js';
import { AbstractSqlDialect, type RelationRows } from './abstractSqlDialect.js';
import { MYSQL_FEATURES } from './mysqlLikeSqlDialect.js';

class TestSqlDialect extends AbstractSqlDialect {
  override readonly dialectName: SqlDialectName = 'mysql';

  override readonly autoIncrementSuffix = 'AUTO_INCREMENT';

  override readonly features: SqlDialectFeatures = {
    ...MYSQL_FEATURES,
    schemas: true,
    ifNotExists: true,
    indexIfNotExists: false,
    dropTableCascade: false,
    foreignKeyAlter: true,
    primaryKeyAlter: true,
    generatedColumnAdd: true,
    commentSyntax: 'inline',
    vectorIndexRequiresNotNull: true,
    vectorSupportsLength: false,
    supportsTimestamptz: false,
    stringSizing: 'varchar',
    supportsUnsigned: false,
    serverSideCursors: false,
  };

  get escapeIdChar() {
    return '`' as const;
  }

  get serialType() {
    return 'SERIAL PRIMARY KEY';
  }

  get tableOptions() {
    return '';
  }

  get beginTransactionCommand() {
    return 'BEGIN';
  }

  get commitTransactionCommand() {
    return 'COMMIT';
  }

  get rollbackTransactionCommand() {
    return 'ROLLBACK';
  }

  override get insertIdSource(): 'firstId' {
    return 'firstId';
  }

  protected override appendRelationArray(ctx: QueryContext, rows: RelationRows): void {
    const { from, pairs } = this.derivedRelation(ctx, rows);
    ctx.append(`(SELECT JSON_ARRAYAGG(JSON_OBJECT(${this.jsonObjectArgs(pairs)})) FROM ${from})`);
  }

  override escape(value: unknown): string {
    return String(value);
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS NUMERIC)`;
  }

  // The JSON fragments are dialect-specific (see `MysqlLikeSqlDialect`, `PgLikeSqlDialect` and
  // `SqliteDialect`); this base-only stand-in never exercises them.
  protected override jsonPullKey(): string {
    return this.unsupported();
  }

  /** Postgres's chain, which the specs below spell their paths in. */
  protected jsonPathReading(escapedColumn: string, path: string, mode: 'json' | 'text'): string {
    const segments = path.split('.');
    return segments.reduce((expr, segment, index) => {
      const op = mode === 'text' && index === segments.length - 1 ? '->>' : '->';
      return `(${expr}${op}'${segment}')`;
    }, escapedColumn);
  }

  protected jsonLength(): string {
    return this.unsupported();
  }

  protected jsonIsArray(): string {
    return this.unsupported();
  }

  protected jsonElemFrom(): string {
    return this.unsupported();
  }

  protected jsonElemDoc(): string {
    return this.unsupported();
  }

  protected jsonSet(): string {
    return this.unsupported();
  }

  protected jsonPush(): string {
    return this.unsupported();
  }

  protected jsonUnset(): string {
    return this.unsupported();
  }

  private unsupported(): never {
    throw TypeError('JSON update operators are not supported by the base SQL dialect');
  }
}

@Entity()
class Shelf {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => VectorItem }) vectorItemId?: number | null;
  @ManyToOne({ entity: () => VectorItem, references: (shelf) => shelf.vectorItemId }) vectorItem?: VectorItem;
}

/** A field the strategy names, one named outright, and an inlined computed one, for `refs()` to render. */
@Entity()
class RefLedger {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  creditLimit?: number | null;
  @Field({ type: String, name: 'display_label' })
  label?: string | null;
  @Field({ type: Number, computed: (ledger) => raw`${ledger.creditLimit} * 2` })
  double?: number | null;
}

describe('AbstractSqlDialect', () => {
  const dialect = new TestSqlDialect();
  const pgr = (limit?: number, skip?: number, sorted = false) => {
    const ctx = dialect.createContext();
    dialect.pager(ctx, { $limit: limit, $skip: skip }, sorted);
    return ctx.sql;
  };

  it('should select nothing for an empty select list', () => {
    expect(dialect.selectTerms(dialect.createContext(), User, [])).toEqual([{ sql: '*', bare: true }]);
  });

  it('should match nothing for an empty $in', () => {
    const ctx = dialect.createContext();
    dialect.compareFieldOperator(ctx, User, 'id', '$in', []);
    expect(ctx.sql).toBe('1 = 0');
  });

  it('should match every row for an empty $nin', () => {
    const ctx = dialect.createContext();
    dialect.compareFieldOperator(ctx, User, 'id', '$nin', []);
    expect(ctx.sql).toBe('1 = 1');
  });

  // Every engine spells full-text search differently, so the base dialect has no form to fall back on.
  it('should reject $text on a dialect that declares no full-text search', () => {
    const ctx = dialect.createContext();
    expect(() => dialect.where(ctx, User, { $text: { $fields: { name: true }, $value: 'x' } })).toThrow(
      'does not support $text full-text search',
    );
  });

  it('should keep a Date for the driver to bind natively', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(dialect.normalizeValue(date)).toBe(date);
  });

  it('should hand a bigint to the driver as it is, which every driver binds exactly', () => {
    expect(dialect.normalizeValue(9007199254740993n)).toBe(9007199254740993n);
  });

  it('should reject a $near that brings no $vector of its own', () => {
    const ctx = dialect.createContext();
    // @ts-expect-error: `$near` needs a `$vector`
    expect(() => dialect.where(ctx, VectorItem, { vec: { $near: { $lt: 0.5 } } })).toThrow(
      "$near on 'vec' needs its own $vector",
    );
  });

  it('should reject a $sort by relation in a statement that joins none', () => {
    const ctx = dialect.createContext();
    expect(() => dialect.sort(ctx, ItemAdjustment, { item: { name: 1 } })).toThrow(
      "cannot $sort by relation 'item': this statement joins no relations",
    );
  });

  it('should read an undefined group operator as no condition at all', () => {
    const ctx = dialect.createContext();
    dialect.where(ctx, Company, { $and: undefined });
    expect(ctx.sql).toBe('');
  });

  it('should reject a $sort by relation that is not a map of its fields', () => {
    const ctx = dialect.createContext();
    // @ts-expect-error: a to-one sorts by its fields
    expect(() => dialect.find(ctx, ItemAdjustment, { $populate: { item: true }, $sort: { item: 1 } })).toThrow(
      "$sort by relation 'item' expects a map of its fields, got 1",
    );
  });

  it('should reject a $vector sort through a relation', () => {
    const ctx = dialect.createContext();
    expect(() =>
      dialect.find(ctx, Shelf, {
        $populate: { vectorItem: true },
        // @ts-expect-error: a relation sorts by no vector
        $sort: { vectorItem: { vec: { $vector: [1, 2, 3] } } },
      }),
    ).toThrow("$vector sort is only supported on the queried entity, not on relation 'vectorItem'");
  });

  it('should emit no HAVING when every condition is undefined', () => {
    const ctx = dialect.createContext();
    dialect.aggregate(ctx, User, {
      $group: { name: true },
      $select: { n: { $count: '*' } },
      $having: { n: undefined },
    });
    expect(ctx.sql).toBe('SELECT `name`, COUNT(*) `n` FROM `User` GROUP BY `name`');
  });

  it('should hydrate an aggregate as its field does, and a count as a number', () => {
    expect(
      dialect.hydratableAggregates(User, {
        $group: { name: true },
        $select: { first: { $min: { createdAt: true } }, n: { $count: '*' } },
      }),
    ).toEqual([
      ['first', 'number'],
      ['n', 'number'],
    ]);
  });

  it('should bind the onUpdate value an upsert payload leaves out', () => {
    const ctx = dialect.createContext();
    dialect.upsert(ctx, User, { id: true }, { id: '1', name: 'John' });
    expect(ctx.sql).toContain('DO UPDATE SET `name` = EXCLUDED.`name`, `updatedAt` = ?');
    expect(ctx.values).toEqual(['1', 'John', expect.any(Number), expect.any(Number)]);
  });

  it('should bind a vector as its text literal', () => {
    const ctx = dialect.createContext();
    dialect.insert(ctx, VectorItem, { vec: [1, 2, 3] });
    expect(ctx.values).toEqual(['[1,2,3]']);
  });
  describe('operators', () => {
    it('should compare with $between', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'createdAt', '$between', [100, 200]);
      expect(ctx.sql).toBe('`createdAt` BETWEEN ? AND ?');
      expect(ctx.values).toEqual([100, 200]);
    });

    it('should compare with $isNull: true', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'name', '$isNull', true);
      expect(ctx.sql).toBe('`name` IS NULL');
    });

    it('should compare with $isNull: false', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'name', '$isNull', false);
      expect(ctx.sql).toBe('`name` IS NOT NULL');
    });

    it('should compare with $isNotNull: true', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'email', '$isNotNull', true);
      expect(ctx.sql).toBe('`email` IS NOT NULL');
    });

    it('should compare with $isNotNull: false', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'email', '$isNotNull', false);
      expect(ctx.sql).toBe('`email` IS NULL');
    });

    it('should build a where clause with $between', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, User, { createdAt: { $between: [1000, 2000] } });
      expect(ctx.sql).toBe(' WHERE `createdAt` BETWEEN ? AND ?');
      expect(ctx.values).toEqual([1000, 2000]);
    });

    it('should build a where clause with $isNull', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, User, { name: { $isNull: true } });
      expect(ctx.sql).toBe(' WHERE `name` IS NULL');
    });

    it('should build a where clause with $isNotNull', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, User, { email: { $isNotNull: true } });
      expect(ctx.sql).toBe(' WHERE `email` IS NOT NULL');
    });
  });
  describe('raw() prefixing', () => {
    it('should leave a raw string in $and unprefixed', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw`(kind->>'public')::boolean IS TRUE`],
      });
      expect(ctx.sql).toBe(" WHERE (kind->>'public')::boolean IS TRUE");
    });

    it('should leave a raw string in $or unprefixed', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $or: [raw`kind IS NULL`, raw`kind = '{}'`],
      });
      expect(ctx.sql).toBe(" WHERE kind IS NULL OR kind = '{}'");
    });

    it('should run a raw function in $and', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw(() => 'custom_check(kind) = TRUE')],
      });
      expect(ctx.sql).toBe(' WHERE custom_check(kind) = TRUE');
    });

    it('should mix a raw string in $and with a regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        name: 'Acme',
        $and: [raw`kind IS NOT NULL`],
      });
      expect(ctx.sql).toBe(' WHERE `name` = ? AND kind IS NOT NULL');
      expect(ctx.values).toEqual(['Acme']);
    });

    /** An alias names a `$select` projection; anywhere else it would land mid-expression. */
    it('should write no alias for a raw outside $select', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { $and: [raw`kind IS NOT NULL`.as('ignored')] });
      expect(ctx.sql).toBe(' WHERE kind IS NOT NULL');
    });

    it('should emit the text of a raw with no interpolation as written, whatever the prefix', () => {
      const ctx = dialect.createContext();
      dialect.getRawValue(ctx, { value: raw`COUNT(*)`, prefix: 'c' });
      expect(ctx.sql).toBe('COUNT(*)');
    });
  });

  describe('raw() as a tagged template', () => {
    it('should bind an interpolated value instead of inlining it', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw`kind = ${'public'}`],
      });
      expect(ctx.sql).toBe(' WHERE kind = ?');
      expect(ctx.values).toEqual(['public']);
    });

    it('should bind a value carrying SQL syntax rather than emitting it', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw`name = ${"' OR 1=1 --"}`],
      });
      expect(ctx.sql).toBe(' WHERE name = ?');
      expect(ctx.values).toEqual(["' OR 1=1 --"]);
    });

    it('should bind every interpolation of a multi-value fragment in order', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw`GREATEST(0, ${10} - ${3}) > ${1}`],
      });
      expect(ctx.sql).toBe(' WHERE GREATEST(0, ? - ?) > ?');
      expect(ctx.values).toEqual([10, 3, 1]);
    });

    it('should resolve an interpolated raw in place so fragments compose', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw`kind = ${'public'} AND ${raw`deleted_at IS NULL`}`],
      });
      expect(ctx.sql).toBe(' WHERE kind = ? AND deleted_at IS NULL');
      expect(ctx.values).toEqual(['public']);
    });

    it('should share the statement values array with the rest of the query', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        name: 'Acme',
        $and: [raw`kind = ${'public'}`],
      });
      expect(ctx.sql).toBe(' WHERE `name` = ? AND kind = ?');
      expect(ctx.values).toEqual(['Acme', 'public']);
    });

    it('should alias a projection built as a template', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, { $select: [raw`LOG10(${100})`.as('score')] });
      expect(ctx.sql).toContain('LOG10(?) `score`');
      expect(ctx.values).toEqual([100]);
    });

    it('should resolve an interpolated callback against the render options', () => {
      const ctx = dialect.createContext();
      dialect.getRawValue(ctx, {
        value: raw`${raw(({ escapedPrefix }) => `${escapedPrefix}kind`)} = ${'public'}`,
        prefix: 'c',
      });
      expect(ctx.sql).toBe('`c`.kind = ?');
      expect(ctx.values).toEqual(['public']);
    });

    it("should drop an interpolated fragment's alias, which belongs to a projection not an expression", () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { $and: [raw`kind = ${raw`'x'`.as('ignored')}`] });
      expect(ctx.sql).toBe(" WHERE kind = 'x'");
    });

    it('should emit a fragment with no interpolation unchanged', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw`kind IS NOT NULL`],
      });
      expect(ctx.sql).toBe(' WHERE kind IS NOT NULL');
      expect(ctx.values).toEqual([]);
    });
  });

  describe('refs()', () => {
    it('should render a field as its column', () => {
      const ledger = refs(RefLedger);
      const ctx = dialect.createContext();
      dialect.where(ctx, RefLedger, { $and: [raw`${ledger.creditLimit} > ${0}`] });
      expect(ctx.sql).toBe(' WHERE `creditLimit` > ?');
      expect(ctx.values).toEqual([0]);
    });

    it('should name the column the way the dialect does', () => {
      const ledger = refs(RefLedger);
      const snake = new TestSqlDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
      const ctx = snake.createContext();
      snake.where(ctx, RefLedger, { $and: [raw`${ledger.creditLimit} > 0 AND ${ledger.label} <> ''`] });
      expect(ctx.sql).toBe(" WHERE `credit_limit` > 0 AND `display_label` <> ''");
    });

    it('should qualify the column by the alias in scope', () => {
      const ctx = dialect.createContext();
      dialect.getRawValue(ctx, { value: raw`${refs(RefLedger).creditLimit}`, prefix: 'l' });
      expect(ctx.sql).toBe('`l`.`creditLimit`');
    });

    it('should render an inlined computed field as its expression', () => {
      const ctx = dialect.createContext();
      dialect.getRawValue(ctx, { value: raw`${refs(RefLedger).double} + 1` });
      expect(ctx.sql).toBe('(`creditLimit` * 2) + 1');
    });

    it("should refuse a definition's ref rendered outside its entity's SQL", () => {
      const sql = entitySql<RefLedger>((ledger) => raw`${ledger.creditLimit}`);
      expect(() => dialect.getRawValue(dialect.createContext(), { value: sql })).toThrow(
        "'creditLimit' was read off a definition's refs, so it renders only inside its entity's SQL",
      );
    });

    it("should qualify refs in a joined relation's $where by the join's alias", () => {
      const tax = refs(Tax);
      const ctx = dialect.createContext();
      dialect.find(ctx, Item, {
        $select: { id: true },
        $populate: {
          tax: { $select: { id: true }, $where: { name: raw`${tax.name}`, $and: [raw`${tax.name} <> ''`] } },
        },
      });
      expect(ctx.sql).toContain("`tax`.`name` = `tax`.`name` AND `tax`.`name` <> ''");
    });
  });
  describe('JSONB dot-notation', () => {
    it('should compare a path by simple equality', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': 1 });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) = CAST(? AS NUMERIC)");
      expect(ctx.values).toEqual([1]);
    });

    it('should compare a path with $eq', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $eq: 'active' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') = ?");
      expect(ctx.values).toEqual(['active']);
    });

    it('should compare a path with $ne', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $ne: 1 } });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) <> CAST(? AS NUMERIC)");
      expect(ctx.values).toEqual([1]);
    });

    it('should compare a path with $gt as a number', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $gt: 0 } });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) > CAST(? AS NUMERIC)");
      expect(ctx.values).toEqual([0]);
    });

    it('should compare a path with $lt as a number', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $lt: 1 } });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) < CAST(? AS NUMERIC)");
      expect(ctx.values).toEqual([1]);
    });

    it('should compare a path with several numeric operators', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $gte: 0, $lte: 1 } });
      expect(ctx.sql).toBe(
        " WHERE (CAST((`kind`->>'public') AS NUMERIC) >= CAST(? AS NUMERIC) AND CAST((`kind`->>'public') AS NUMERIC) <= CAST(? AS NUMERIC))",
      );
      expect(ctx.values).toEqual([0, 1]);
    });

    it('should compare a path with $like', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $like: '%test%' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['%test%']);
    });

    it('should compare a path with $startsWith', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $startsWith: 'pre' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['pre%']);
    });

    it('should compare a path with $endsWith', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $endsWith: 'fix' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['%fix']);
    });

    it('should compare a path with $includes', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $includes: 'mid' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['%mid%']);
    });

    it('should compare a path with $regex', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $regex: '^test' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') REGEXP ?");
      expect(ctx.values).toEqual(['^test']);
    });

    it('should compare a path with $in', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.country': { $in: ['a', 'b', 'c'] } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'country') IN (?, ?, ?)");
      expect(ctx.values).toEqual(['a', 'b', 'c']);
    });

    it('should compare a path with $nin', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.country': { $nin: ['x', 'y'] } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'country') NOT IN (?, ?)");
      expect(ctx.values).toEqual(['x', 'y']);
    });

    it('should compare a path with $in and $nin over booleans, as JSON', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: booleans where the entity declares 0 | 1
      dialect.where(ctx, Company, { 'kind.public': { $in: [true, false] }, 'kind.private': { $nin: [true] } });
      expect(ctx.sql).toBe(
        " WHERE ((`kind`->'public') = CAST(? AS JSON) OR (`kind`->'public') = CAST(? AS JSON))" +
          " AND ((`kind`->'private') <> CAST(? AS JSON))",
      );
      expect(ctx.values).toEqual(['true', 'false', 'true']);
    });

    it('should reject an $in that is not an array, as a column does', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: `$in` takes a list
      expect(() => dialect.where(ctx, Company, { 'kind.country': { $in: 'a' } })).toThrow(
        '$in expects an array, got string',
      );
    });

    it('should read an array on a path as $in', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.country': ['a', 'b'] });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'country') IN (?, ?)");
      expect(ctx.values).toEqual(['a', 'b']);
    });

    it('should compare a path two levels deep', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.theme.color': 'red' });
      expect(ctx.sql).toBe(" WHERE ((`kind`->'theme')->>'color') = ?");
      expect(ctx.values).toEqual(['red']);
    });

    it('should combine a path with a regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { name: 'Acme', 'kind.public': 1 });
      expect(ctx.sql).toBe(" WHERE `name` = ? AND CAST((`kind`->>'public') AS NUMERIC) = CAST(? AS NUMERIC)");
      expect(ctx.values).toEqual(['Acme', 1]);
    });

    it('should combine a path with $and', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [{ 'kind.public': { $eq: 1 } }, { 'kind.private': { $ne: 0 } }],
      });
      expect(ctx.sql).toBe(
        " WHERE CAST((`kind`->>'public') AS NUMERIC) = CAST(? AS NUMERIC) AND CAST((`kind`->>'private') AS NUMERIC) <> CAST(? AS NUMERIC)",
      );
      expect(ctx.values).toEqual([1, 0]);
    });

    it('should combine several paths on the same column', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        'kind.public': 1,
        'kind.private': { $ne: 0 },
      });
      expect(ctx.sql).toBe(
        " WHERE CAST((`kind`->>'public') AS NUMERIC) = CAST(? AS NUMERIC) AND CAST((`kind`->>'private') AS NUMERIC) <> CAST(? AS NUMERIC)",
      );
      expect(ctx.values).toEqual([1, 0]);
    });

    it('should read $eq null on a path as IS NULL', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $eq: null } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') IS NULL");
      expect(ctx.values).toEqual([]);
    });

    it('should read $ne null on a path as IS NOT NULL', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $ne: null } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') IS NOT NULL");
      expect(ctx.values).toEqual([]);
    });
  });
  describe('relation filtering', () => {
    it('should filter by a many-to-many on id equality', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { id: '5' } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `tags`.`id` FROM `Tag` `tags` WHERE `tags`.`id` = ?))',
      );
      expect(ctx.values).toEqual(['5']);
    });

    it('should filter by a many-to-many with an operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { name: { $like: '%react%' } } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `tags`.`id` FROM `Tag` `tags` WHERE `tags`.`name` LIKE ?))',
      );
      expect(ctx.values).toEqual(['%react%']);
    });

    it('should filter by a many-to-many on several conditions of the related entity', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { id: '1', name: 'urgent' } });
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.sql).toContain('`tags`.`id` = ?');
      expect(ctx.sql).toContain('`tags`.`name` = ?');
      expect(ctx.values).toEqual(['1', 'urgent']);
    });

    it('should filter by a one-to-many', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { name: 'kg' } });
      // Both entities have softDelete: the parent's condition sits outside the EXISTS, the target's
      // inside it, so a category never matches through a trashed measure unit.
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id` AND `measureUnits`.`name` = ? AND `measureUnits`.`deletedAt` IS NULL) AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual(['kg']);
    });

    it('should scope a soft-delete inside the EXISTS to the target, not the parent', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { name: 'kg' } });
      const existsPart = ctx.sql.split('EXISTS (')[1].split(')')[0];
      expect(existsPart).toContain('`measureUnits`.`deletedAt` IS NULL');
      // the parent's own (unprefixed) condition stays out of the subquery
      expect(existsPart).not.toContain(' `deletedAt` IS NULL');
    });

    it('should combine a relation filter with a regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { companyId: '1', tags: { name: 'urgent' } });
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.values).toEqual(['1', 'urgent']);
    });

    it('should combine a many-to-many filter with a regular field and raw', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, {
        companyId: '1',
        tags: { name: 'test' },
        $and: [raw`code IS NOT NULL`],
      });
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.sql).toContain('code IS NOT NULL');
      expect(ctx.values).toEqual(['1', 'test']);
    });

    it('should filter by a many-to-one', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, ItemAdjustment, { item: { name: 'Widget' } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `Item` `item` WHERE `item`.`id` = `ItemAdjustment`.`itemId` AND `item`.`name` = ?)',
      );
      expect(ctx.values).toEqual(['Widget']);
    });

    it('should filter by a many-to-one with an operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, ItemAdjustment, { item: { name: { $like: '%test%' } } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `Item` `item` WHERE `item`.`id` = `ItemAdjustment`.`itemId` AND `item`.`name` LIKE ?)',
      );
      expect(ctx.values).toEqual(['%test%']);
    });

    it('should combine a many-to-one filter with a regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, ItemAdjustment, { number: 5, item: { name: 'Widget' } });
      expect(ctx.sql).toContain('`number` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `Item`');
      expect(ctx.values).toEqual([5, 'Widget']);
    });
  });
  describe('edge cases', () => {
    it('should throw on an unsupported JSON operator', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: no such operator
      expect(() => dialect.where(ctx, Company, { 'kind.public': { $unsupported: 1 } })).toThrow(
        'unknown operator: $unsupported',
      );
    });

    it('should fall back to LOWER() for $ilike on the base dialect', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $ilike: '%Active%' } });
      expect(ctx.sql).toBe(" WHERE LOWER((`kind`->>'description')) LIKE ?");
      expect(ctx.values).toEqual(['%active%']);
    });
  });

  /** A key a query brings is plain data: it never resolves through `Object.prototype`, nor reaches SQL unchecked. */
  describe('unsafe map lookups', () => {
    it('should reject an operator key that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: no such operator
      expect(() => dialect.where(ctx, User, { name: { toString: 'x' } })).toThrow('unknown operator: toString');
    });

    it('should reject a HAVING operator key that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() =>
        dialect.aggregate(ctx, User, {
          $select: { total: { $sum: { createdAt: true } } },
          // @ts-expect-error: no such operator
          $having: { total: { toString: 5 } },
        }),
      ).toThrow('unsupported HAVING operator: toString');
    });

    it('should reject a sort direction that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: no such direction
      expect(() => dialect.find(ctx, User, { $sort: { name: 'toString' } })).toThrow(
        'unknown sort direction: toString',
      );
    });

    it('should reject an aggregate sort direction that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() =>
        dialect.aggregate(ctx, User, {
          $select: { total: { $sum: { createdAt: true } } },
          // @ts-expect-error: no such direction
          $sort: { total: 'toString' },
        }),
      ).toThrow('unknown sort direction: toString');
    });

    it('should reject an aggregate function key that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: no such function
      expect(() => dialect.aggregate(ctx, User, { $select: { total: { toString: 'id' } } })).toThrow(
        'unsupported aggregate operator: toString',
      );
    });

    it('should reject an arbitrary aggregate function key rather than splice it into SQL', () => {
      const ctx = dialect.createContext();
      expect(() =>
        dialect.aggregate(ctx, User, {
          // @ts-expect-error: no such function
          $select: { total: { '$SUM(id); DROP TABLE users; --': 'id' } },
        }),
      ).toThrow('unsupported aggregate operator');
      expect(ctx.sql).not.toContain('DROP TABLE');
    });
  });

  describe('relation $count sort', () => {
    it('should rank parents by a correlated count, not by a join', () => {
      const ctx = dialect.createContext();
      dialect.sort(ctx, MeasureUnitCategory, { measureUnits: { $count: -1 } });
      expect(ctx.sql).toBe(
        ' ORDER BY (SELECT COUNT(*) FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id`' +
          ' AND `measureUnits`.`deletedAt` IS NULL) DESC',
      );
      expect(ctx.values).toEqual([]);
    });

    it('should count junction rows for a many-to-many', () => {
      const ctx = dialect.createContext();
      dialect.sort(ctx, Item, { tags: { $count: 1 } });
      expect(ctx.sql).toBe(' ORDER BY (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`)');
    });

    it('should compose with an ordering by the parent own columns', () => {
      const ctx = dialect.createContext();
      dialect.sort(ctx, MeasureUnitCategory, { measureUnits: { $count: -1 }, name: 1 });
      expect(ctx.sql).toContain('DESC, `name`');
    });

    it('should reject a $count combined with other keys', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: a to-many sorts by `$count` alone
      expect(() => dialect.sort(ctx, MeasureUnitCategory, { measureUnits: { $count: -1, name: 1 } })).toThrow(
        '$count in a $sort cannot be combined with other keys',
      );
    });
  });
  describe('relation $size', () => {
    it('should filter by a one-to-many $size equal to a number', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: 3 } });
      expect(ctx.sql).toBe(
        ' WHERE (SELECT COUNT(*) FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id` AND `measureUnits`.`deletedAt` IS NULL) = ? AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual([3]);
    });

    it('should filter by a one-to-many $size with $gte', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $gte: 2 } } });
      expect(ctx.sql).toBe(
        ' WHERE (SELECT COUNT(*) FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id` AND `measureUnits`.`deletedAt` IS NULL) >= ? AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual([2]);
    });

    it('should filter by a one-to-many $size with $eq', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $eq: 1 } } });
      expect(ctx.sql).toContain(') = ?');
      expect(ctx.values).toEqual([1]);
    });

    it('should filter by a one-to-many $size with $ne', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $ne: 0 } } });
      expect(ctx.sql).toContain(') <> ?');
      expect(ctx.values).toEqual([0]);
    });

    it('should filter by a one-to-many $size with $lt', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $lt: 10 } } });
      expect(ctx.sql).toContain(') < ?');
      expect(ctx.values).toEqual([10]);
    });

    it('should filter by a one-to-many $size with $lte', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $lte: 5 } } });
      expect(ctx.sql).toContain(') <= ?');
      expect(ctx.values).toEqual([5]);
    });

    it('should filter by a many-to-many $size equal to a number', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { $size: 5 } });
      expect(ctx.sql).toBe(' WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) = ?');
      expect(ctx.values).toEqual([5]);
    });

    it('should filter by a many-to-many $size with $gt', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { $size: { $gt: 0 } } });
      expect(ctx.sql).toBe(' WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) > ?');
      expect(ctx.values).toEqual([0]);
    });

    it('should filter by a many-to-many $size with $between', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { $size: { $between: [2, 8] } } });
      expect(ctx.sql).toBe(
        ' WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) BETWEEN ? AND ?',
      );
      expect(ctx.values).toEqual([2, 8]);
    });

    it('should combine a relation $size with a regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { companyId: '1', tags: { $size: { $gte: 2 } } });
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('(SELECT COUNT(*) FROM `ItemTag`');
      expect(ctx.sql).toContain('>= ?');
      expect(ctx.values).toEqual(['1', 2]);
    });

    it('should throw for unsupported $size comparison operator', () => {
      const ctx = dialect.createContext();
      // @ts-expect-error: no such comparison
      expect(() => dialect.where(ctx, Item, { tags: { $size: { $like: 5 } } })).toThrow(
        'unsupported $size comparison operator: $like',
      );
    });
  });
  describe('$sort JSONB dot-notation', () => {
    it('should sort by a path one level deep', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.public': 1 },
      });
      expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY (`kind`->'public')");
    });

    it('should sort by a path several levels deep', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.theme.color': -1 },
      });
      expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY ((`kind`->'theme')->'color') DESC");
    });

    it('should combine a path sort with a regular sort', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { name: 1, 'kind.public': -1 },
      });
      expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY `name`, (`kind`->'public') DESC");
    });
  });

  /**
   * An inlined field has no column, so every clause naming it has to write the expression out. `$sort`
   * wrote the output alias instead, which exists only when the field was also selected - so ordering by
   * one you did not select failed on the server with `column "tagsCount" does not exist`.
   */
  describe('$sort on an inlined computed field', () => {
    const tagsCountOperand = '(SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`)';

    it('should order by the expression, not by an alias that may not exist', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Item, { $select: { id: true }, $sort: { tagsCount: -1 } });

      expect(ctx.sql).toBe(`SELECT \`id\` FROM \`Item\` ORDER BY ${tagsCountOperand} DESC`);
    });

    /** One field, one rendering: the clause that reads it must not decide the operand for itself. */
    it('should build the same operand $where does', () => {
      const filtered = dialect.createContext();
      dialect.find(filtered, Item, { $select: { id: true }, $where: { tagsCount: 1 } });

      expect(filtered.sql).toContain(`WHERE ${tagsCountOperand} = ?`);
    });

    it('should order by the column itself when the field is a real one', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Item, { $select: { id: true }, $sort: { name: 1 } });

      expect(ctx.sql).toBe('SELECT `id` FROM `Item` ORDER BY `name`');
    });
  });
  describe('$distinct', () => {
    it('should generate SELECT DISTINCT with $distinct: true', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, { $distinct: true });
      expect(ctx.sql).toMatch(/^SELECT DISTINCT /);
    });

    it('should generate plain SELECT without $distinct', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {});
      expect(ctx.sql).toMatch(/^SELECT /);
      expect(ctx.sql).not.toMatch(/^SELECT DISTINCT /);
    });

    it('should read $distinct: false as no $distinct', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, { $distinct: false });
      expect(ctx.sql).toMatch(/^SELECT /);
      expect(ctx.sql).not.toMatch(/^SELECT DISTINCT /);
    });

    it('should apply $distinct to a $select', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {
        $distinct: true,
        $select: { name: true, email: true },
      });
      expect(ctx.sql).toBe('SELECT DISTINCT `name`, `email` FROM `User`');
    });

    it('should apply $distinct with $where and $sort', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {
        $distinct: true,
        $select: { name: true },
        $where: { companyId: '1' },
        $sort: { name: 1 },
      });
      expect(ctx.sql).toBe('SELECT DISTINCT `name` FROM `User` WHERE `companyId` = ? ORDER BY `name`');
      expect(ctx.values).toEqual(['1']);
    });

    it('should apply $distinct with $limit and $skip', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {
        $distinct: true,
        $select: { email: true },
        $limit: 10,
        $skip: 5,
      });
      expect(ctx.sql).toBe(`SELECT DISTINCT \`email\` FROM \`User\`${pgr(10, 5, false)}`);
      expect(ctx.values).toEqual([]);
    });
  });
});
