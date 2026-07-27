import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Company, Item, ItemAdjustment, MeasureUnitCategory, User } from '../test/index.js';
import type { DialectFeatures, SqlDialectName } from '../type/index.js';
import { raw } from '../util/index.js';
import { AbstractSqlDialect } from './abstractSqlDialect.js';

class TestSqlDialect extends AbstractSqlDialect {
  override readonly dialectName: SqlDialectName = 'mysql';

  protected override readonly featureDefaults: DialectFeatures = {
    explicitJsonCast: false,
    nativeArrays: false,
    supportsJsonb: false,
    ifNotExists: true,
    indexIfNotExists: false,
    dropTableCascade: false,
    renameColumn: true,
    foreignKeyAlter: true,
    columnComment: true,
    vectorIndexStyle: 'inline',
    vectorSupportsLength: false,
    supportsTimestamptz: false,
    defaultStringAsText: false,
  };

  get escapeIdChar() {
    return '`' as const;
  }

  get serialPrimaryKey() {
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

  escape(value: unknown): string {
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

  protected jsonAll(): string {
    return this.unsupported();
  }

  protected jsonSize(): string {
    return this.unsupported();
  }

  protected jsonElemFrom(): string {
    return this.unsupported();
  }

  protected jsonElemRef(): string {
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

describe('AbstractSqlDialect (extra coverage)', () => {
  const dialect = new TestSqlDialect();

  it('selectFields with empty selectArr', () => {
    const ctx = dialect.createContext();
    dialect.selectFields(ctx, User, []);
    expect(ctx.sql).toBe('*');
  });

  it('compareFieldOperator $in with empty array', () => {
    const ctx = dialect.createContext();
    dialect.compareFieldOperator(ctx, User, 'id', '$in', []);
    expect(ctx.sql).toBe('`id` IN (NULL)');
  });

  it('compareFieldOperator $nin with empty array', () => {
    const ctx = dialect.createContext();
    dialect.compareFieldOperator(ctx, User, 'id', '$nin', []);
    expect(ctx.sql).toBe('`id` NOT IN (NULL)');
  });

  it('normalizeValue keeps Date for driver-native binding', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(dialect.normalizeValue(date)).toBe(date);
  });

  it('upsert without update assignments (INSERT IGNORE)', () => {
    const ctx = dialect.createContext();
    // User has id, companyId, creatorId, createdAt, updatedAt, name, email, password
    // If conflictPaths includes all fields except virtual ones, update will be empty
    const conflictPaths = {
      id: true,
      companyId: true,
      creatorId: true,
      createdAt: true,
      updatedAt: true,
      name: true,
      email: true,
      password: true,
    };
    dialect.upsert(ctx, User, conflictPaths as any, { name: 'John' });
    expect(ctx.sql).toContain('INSERT IGNORE');
  });

  it('getUpsertUpdateAssignments without callback', () => {
    const ctx = dialect.createContext();
    const meta = getMeta(User);
    const assignments = (dialect as any).getUpsertUpdateAssignments(ctx, meta, { id: true }, { name: 'John' });
    expect(assignments).toContain('`name` = ?');
    expect(ctx.values).toContain('John');
  });

  it('getPersistables and getPersistable', () => {
    const ctx = dialect.createContext();
    const meta = getMeta(User);
    const persistables = (dialect as any).getPersistables(ctx, meta, { name: 'John' }, 'onInsert');
    expect(persistables[0].name).toBe('?');
    expect(ctx.values).toContain('John');
  });

  it('formatPersistableValue with vector type', () => {
    const ctx = dialect.createContext();
    const field = { type: 'vector' as any };
    (dialect as any).formatPersistableValue(ctx, field, [1, 2, 3]);
    expect(ctx.values[0]).toBe('[1,2,3]');
  });

  // New operator tests
  describe('new operators', () => {
    it('compareFieldOperator $between', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'createdAt', '$between', [100, 200] as any);
      expect(ctx.sql).toBe('`createdAt` BETWEEN ? AND ?');
      expect(ctx.values).toEqual([100, 200]);
    });

    it('compareFieldOperator $isNull with true', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'name', '$isNull', true);
      expect(ctx.sql).toBe('`name` IS NULL');
    });

    it('compareFieldOperator $isNull with false', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'name', '$isNull', false);
      expect(ctx.sql).toBe('`name` IS NOT NULL');
    });

    it('compareFieldOperator $isNotNull with true', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'email', '$isNotNull', true);
      expect(ctx.sql).toBe('`email` IS NOT NULL');
    });

    it('compareFieldOperator $isNotNull with false', () => {
      const ctx = dialect.createContext();
      dialect.compareFieldOperator(ctx, User, 'email', '$isNotNull', false);
      expect(ctx.sql).toBe('`email` IS NULL');
    });

    it('where clause with $between', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, User, { createdAt: { $between: [1000, 2000] } });
      expect(ctx.sql).toBe(' WHERE `createdAt` BETWEEN ? AND ?');
      expect(ctx.values).toEqual([1000, 2000]);
    });

    it('where clause with $isNull', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, User, { name: { $isNull: true } });
      expect(ctx.sql).toBe(' WHERE `name` IS NULL');
    });

    it('where clause with $isNotNull', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, User, { email: { $isNotNull: true } });
      expect(ctx.sql).toBe(' WHERE `email` IS NOT NULL');
    });
  });

  // ─── raw() prefix bug fix ───────────────────────────────────────────
  describe('raw() prefix fix', () => {
    it('raw string in $and should not be prefixed', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw("(kind->>'public')::boolean IS TRUE")],
      });
      expect(ctx.sql).toBe(" WHERE (kind->>'public')::boolean IS TRUE");
    });

    it('raw string in $or should not be prefixed', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $or: [raw('kind IS NULL'), raw("kind = '{}'")],
      });
      expect(ctx.sql).toBe(" WHERE kind IS NULL OR kind = '{}'");
    });

    it('raw function in $and should still work (regression)', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw(() => 'custom_check(kind) = TRUE')],
      });
      expect(ctx.sql).toBe(' WHERE custom_check(kind) = TRUE');
    });

    it('raw string in $and mixed with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        name: 'Acme',
        $and: [raw('kind IS NOT NULL')],
      });
      expect(ctx.sql).toBe(' WHERE `name` = ? AND kind IS NOT NULL');
      expect(ctx.values).toEqual(['Acme']);
    });
  });

  // ─── JSONB dot-notation ────────────────────────────────────────────
  describe('JSONB dot-notation', () => {
    it('simple equality', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': 1 });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) = ?");
      expect(ctx.values).toEqual([1]);
    });

    it('with $eq operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $eq: 'active' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') = ?");
      expect(ctx.values).toEqual(['active']);
    });

    it('with $ne operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $ne: 1 } });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) <> ?");
      expect(ctx.values).toEqual([1]);
    });

    it('with $gt numeric operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $gt: 0 } });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) > ?");
      expect(ctx.values).toEqual([0]);
    });

    it('with $lt numeric operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $lt: 1 } });
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) < ?");
      expect(ctx.values).toEqual([1]);
    });

    it('with multiple numeric operators', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $gte: 0, $lte: 1 } });
      expect(ctx.sql).toBe(
        " WHERE (CAST((`kind`->>'public') AS NUMERIC) >= ? AND CAST((`kind`->>'public') AS NUMERIC) <= ?)",
      );
      expect(ctx.values).toEqual([0, 1]);
    });

    it('with $like string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $like: '%test%' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['%test%']);
    });

    it('with $startsWith string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $startsWith: 'pre' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['pre%']);
    });

    it('with $endsWith string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $endsWith: 'fix' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['%fix']);
    });

    it('with $includes string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $includes: 'mid' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') LIKE ?");
      expect(ctx.values).toEqual(['%mid%']);
    });

    it('with $regex operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $regex: '^test' } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'description') REGEXP ?");
      expect(ctx.values).toEqual(['^test']);
    });

    it('with $in operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.country': { $in: ['a', 'b', 'c'] } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'country') IN (?, ?, ?)");
      expect(ctx.values).toEqual(['a', 'b', 'c']);
    });

    it('with $nin operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.country': { $nin: ['x', 'y'] } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'country') NOT IN (?, ?)");
      expect(ctx.values).toEqual(['x', 'y']);
    });

    it('with array shorthand (maps to $in)', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.country': ['a', 'b'] });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'country') IN (?, ?)");
      expect(ctx.values).toEqual(['a', 'b']);
    });

    it('deep nested path (two levels)', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.theme.color': 'red' });
      expect(ctx.sql).toBe(" WHERE ((`kind`->'theme')->>'color') = ?");
      expect(ctx.values).toEqual(['red']);
    });

    it('combined with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { name: 'Acme', 'kind.public': 1 });
      expect(ctx.sql).toBe(" WHERE `name` = ? AND CAST((`kind`->>'public') AS NUMERIC) = ?");
      expect(ctx.values).toEqual(['Acme', 1]);
    });

    it('combined with $and', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [{ 'kind.public': { $eq: 1 } }, { 'kind.private': { $ne: 0 } }],
      });
      expect(ctx.sql).toBe(
        " WHERE CAST((`kind`->>'public') AS NUMERIC) = ? AND CAST((`kind`->>'private') AS NUMERIC) <> ?",
      );
      expect(ctx.values).toEqual([1, 0]);
    });

    it('multiple dot-paths on same column', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        'kind.public': 1,
        'kind.private': { $ne: 0 },
      });
      expect(ctx.sql).toBe(
        " WHERE CAST((`kind`->>'public') AS NUMERIC) = ? AND CAST((`kind`->>'private') AS NUMERIC) <> ?",
      );
      expect(ctx.values).toEqual([1, 0]);
    });

    it('$eq with null value', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $eq: null } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') IS NULL");
      expect(ctx.values).toEqual([]);
    });

    it('$ne with null value', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $ne: null } });
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') IS NOT NULL");
      expect(ctx.values).toEqual([]);
    });
  });

  // ─── Relation filtering ───────────────────────────────────────────
  describe('relation filtering', () => {
    it('ManyToMany with simple id equality', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { id: 5 } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `Tag`.`id` FROM `Tag` WHERE `Tag`.`id` = ?))',
      );
      expect(ctx.values).toEqual([5]);
    });

    it('ManyToMany with operator filter', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { name: { $like: '%react%' } } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `Tag`.`id` FROM `Tag` WHERE `Tag`.`name` LIKE ?))',
      );
      expect(ctx.values).toEqual(['%react%']);
    });

    it('ManyToMany with multiple conditions on related entity', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { id: 1, name: 'urgent' } });
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.sql).toContain('`Tag`.`id` = ?');
      expect(ctx.sql).toContain('`Tag`.`name` = ?');
      expect(ctx.values).toEqual([1, 'urgent']);
    });

    it('OneToMany with simple filter', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { name: 'kg' } });
      // MeasureUnitCategory has softDelete, so parent query adds AND `deletedAt` IS NULL
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `MeasureUnit` WHERE `MeasureUnit`.`categoryId` = `MeasureUnitCategory`.`id` AND `MeasureUnit`.`name` = ?) AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual(['kg']);
    });

    it('inner EXISTS subquery should not leak softDelete conditions', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { name: 'kg' } });
      const existsPart = ctx.sql.split('EXISTS (')[1].split(')')[0];
      // softDelete condition should NOT appear inside the EXISTS subquery
      expect(existsPart).not.toContain('deletedAt');
    });

    it('combined with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { companyId: 1, tags: { name: 'urgent' } });
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.values).toEqual([1, 'urgent']);
    });

    it('ManyToMany combined with regular field and raw', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, {
        companyId: 1,
        tags: { name: 'test' },
        $and: [raw('code IS NOT NULL')],
      });
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.sql).toContain('code IS NOT NULL');
      expect(ctx.values).toEqual([1, 'test']);
    });

    it('ManyToOne with simple filter', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, ItemAdjustment, { item: { name: 'Widget' } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `Item` WHERE `Item`.`id` = `ItemAdjustment`.`itemId` AND `Item`.`name` = ?)',
      );
      expect(ctx.values).toEqual(['Widget']);
    });

    it('ManyToOne with operator filter', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, ItemAdjustment, { item: { name: { $like: '%test%' } } });
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `Item` WHERE `Item`.`id` = `ItemAdjustment`.`itemId` AND `Item`.`name` LIKE ?)',
      );
      expect(ctx.values).toEqual(['%test%']);
    });

    it('ManyToOne combined with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, ItemAdjustment, { number: 5, item: { name: 'Widget' } });
      expect(ctx.sql).toContain('`number` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `Item`');
      expect(ctx.values).toEqual([5, 'Widget']);
    });
  });

  // ─── Branch coverage: error & fallback paths ─────────────────────
  describe('edge cases', () => {
    it('unsupported JSON operator throws TypeError', () => {
      const ctx = dialect.createContext();
      expect(() => dialect.where(ctx, Company, { 'kind.public': { $unsupported: 1 } } as any)).toThrow(
        'unknown operator: $unsupported',
      );
    });

    it('base dialect $ilike uses LOWER() fallback', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.description': { $ilike: '%Active%' } });
      expect(ctx.sql).toBe(" WHERE LOWER((`kind`->>'description')) LIKE ?");
      expect(ctx.values).toEqual(['%active%']);
    });

    it('relation with missing references throws TypeError', () => {
      const meta = getMeta(Item);
      const tagRelation = meta.relations.tags;
      if (!tagRelation) throw new Error('Test setup: tags relation must exist');
      const originalRefs = tagRelation.references;
      tagRelation.references = undefined;
      try {
        const ctx = dialect.createContext();
        expect(() => dialect.where(ctx, Item, { tags: { id: 1 } })).toThrow('has no references defined');
      } finally {
        tagRelation.references = originalRefs;
      }
    });
  });

  // ─── Unsafe map lookups: an unvalidated query-provided key (queries are plain data) must
  // never resolve via the Object.prototype chain, nor be spliced into SQL unchecked ─────────
  describe('unsafe map lookups', () => {
    it('compareFieldOperator rejects an operator key that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() => dialect.where(ctx, User, { name: { toString: 'x' } } as any)).toThrow('unknown operator: toString');
    });

    it('having rejects an operator key that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() =>
        dialect.aggregate(ctx, User, {
          $agg: { total: { $sum: 'id' } },
          $having: { total: { toString: 5 } },
        } as any),
      ).toThrow('unsupported HAVING operator: toString');
    });

    it('sort rejects a direction that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() => dialect.find(ctx, User, { $sort: { name: 'toString' } } as any)).toThrow(
        'unknown sort direction: toString',
      );
    });

    it('aggregateSort rejects a direction that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() =>
        dialect.aggregate(ctx, User, {
          $agg: { total: { $sum: 'id' } },
          $sort: { total: 'toString' },
        } as any),
      ).toThrow('unknown sort direction: toString');
    });

    it('aggregate rejects a $group operator key that only exists on Object.prototype', () => {
      const ctx = dialect.createContext();
      expect(() => dialect.aggregate(ctx, User, { $agg: { total: { toString: 'id' } } } as any)).toThrow(
        'unsupported aggregate operator: toString',
      );
    });

    it('aggregate rejects an arbitrary $group operator key instead of splicing it as a SQL function name', () => {
      const ctx = dialect.createContext();
      expect(() =>
        dialect.aggregate(ctx, User, {
          $agg: { total: { '$SUM(id); DROP TABLE users; --': 'id' } },
        } as any),
      ).toThrow('unsupported aggregate operator');
      expect(ctx.sql).not.toContain('DROP TABLE');
    });
  });

  // ─── Relation $size (count) filtering ─────────────────────────────
  describe('relation $size', () => {
    it('OneToMany with exact match', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: 3 } });
      expect(ctx.sql).toBe(
        ' WHERE (SELECT COUNT(*) FROM `MeasureUnit` WHERE `MeasureUnit`.`categoryId` = `MeasureUnitCategory`.`id`) = ? AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual([3]);
    });

    it('OneToMany with $gte comparison', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $gte: 2 } } });
      expect(ctx.sql).toBe(
        ' WHERE (SELECT COUNT(*) FROM `MeasureUnit` WHERE `MeasureUnit`.`categoryId` = `MeasureUnitCategory`.`id`) >= ? AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual([2]);
    });

    it('OneToMany with $eq comparison', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $eq: 1 } } });
      expect(ctx.sql).toContain(') = ?');
      expect(ctx.values).toEqual([1]);
    });

    it('OneToMany with $ne comparison', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $ne: 0 } } });
      expect(ctx.sql).toContain(') <> ?');
      expect(ctx.values).toEqual([0]);
    });

    it('OneToMany with $lt comparison', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $lt: 10 } } });
      expect(ctx.sql).toContain(') < ?');
      expect(ctx.values).toEqual([10]);
    });

    it('OneToMany with $lte comparison', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { $size: { $lte: 5 } } });
      expect(ctx.sql).toContain(') <= ?');
      expect(ctx.values).toEqual([5]);
    });

    it('ManyToMany with exact match', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { $size: 5 } });
      expect(ctx.sql).toBe(' WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) = ?');
      expect(ctx.values).toEqual([5]);
    });

    it('ManyToMany with $gt comparison', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { $size: { $gt: 0 } } });
      expect(ctx.sql).toBe(' WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) > ?');
      expect(ctx.values).toEqual([0]);
    });

    it('ManyToMany with $between', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { $size: { $between: [2, 8] } } });
      expect(ctx.sql).toBe(
        ' WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) BETWEEN ? AND ?',
      );
      expect(ctx.values).toEqual([2, 8]);
    });

    it('combined with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { companyId: 1, tags: { $size: { $gte: 2 } } });
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('(SELECT COUNT(*) FROM `ItemTag`');
      expect(ctx.sql).toContain('>= ?');
      expect(ctx.values).toEqual([1, 2]);
    });

    it('throws for unsupported $size comparison operator', () => {
      const ctx = dialect.createContext();
      expect(() => dialect.where(ctx, Item, { tags: { $size: { $like: 5 } } } as any)).toThrow(
        'unsupported $size comparison operator: $like',
      );
    });

    it('throws for relation with missing references', () => {
      const meta = getMeta(Item);
      const tagRelation = meta.relations.tags;
      if (!tagRelation) throw new Error('Test setup: tags relation must exist');
      const originalRefs = tagRelation.references;
      tagRelation.references = undefined;
      try {
        const ctx = dialect.createContext();
        expect(() => dialect.where(ctx, Item, { tags: { $size: 1 } })).toThrow('has no references defined');
      } finally {
        tagRelation.references = originalRefs;
      }
    });
  });

  // ─── $sort JSONB dot-notation tests ───────────────────────────────
  describe('$sort JSONB dot-notation', () => {
    it('single level sort', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.public': 1 },
      });
      expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY (`kind`->>'public')");
    });

    it('deep nested sort', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.theme.color': -1 },
      });
      expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY ((`kind`->'theme')->>'color') DESC");
    });

    it('combined with regular sort', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { name: 1, 'kind.public': -1 },
      });
      expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY `name`, (`kind`->>'public') DESC");
    });
  });

  // ─── $distinct ────────────────────────────────────────────────────
  describe('$distinct', () => {
    it('generates SELECT DISTINCT with $distinct: true', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, { $distinct: true });
      expect(ctx.sql).toMatch(/^SELECT DISTINCT /);
    });

    it('generates plain SELECT without $distinct', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {});
      expect(ctx.sql).toMatch(/^SELECT /);
      expect(ctx.sql).not.toMatch(/^SELECT DISTINCT /);
    });

    it('$distinct: false behaves same as omitted', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, { $distinct: false });
      expect(ctx.sql).toMatch(/^SELECT /);
      expect(ctx.sql).not.toMatch(/^SELECT DISTINCT /);
    });

    it('$distinct with $select', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {
        $distinct: true,
        $select: { name: true, email: true },
      });
      expect(ctx.sql).toBe('SELECT DISTINCT `name`, `email` FROM `User`');
    });

    it('$distinct with $where and $sort', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {
        $distinct: true,
        $select: { name: true },
        $where: { companyId: 1 },
        $sort: { name: 1 },
      });
      expect(ctx.sql).toBe('SELECT DISTINCT `name` FROM `User` WHERE `companyId` = ? ORDER BY `name`');
      expect(ctx.values).toEqual([1]);
    });

    it('$distinct with $limit and $skip', () => {
      const ctx = dialect.createContext();
      dialect.find(ctx, User, {
        $distinct: true,
        $select: { email: true },
        $limit: 10,
        $skip: 5,
      });
      expect(ctx.sql).toBe('SELECT DISTINCT `email` FROM `User` LIMIT 10 OFFSET 5');
      expect(ctx.values).toEqual([]);
    });
  });
});
