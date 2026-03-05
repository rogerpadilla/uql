import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Company, Item, MeasureUnitCategory, User } from '../test/index.js';
import { raw } from '../util/index.js';
import { AbstractSqlDialect } from './abstractSqlDialect.js';

class TestSqlDialect extends AbstractSqlDialect {
  constructor() {
    super('mysql');
  }
  escape(value: unknown): string {
    return String(value);
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

    it('compareFieldOperator $all throws for base SQL', () => {
      const ctx = dialect.createContext();
      expect(() => {
        dialect.compareFieldOperator(ctx, User, 'name', '$all', ['admin', 'user'] as any);
      }).toThrow('$all is not supported in the base SQL dialect');
    });

    it('compareFieldOperator $size throws for base SQL', () => {
      const ctx = dialect.createContext();
      expect(() => {
        dialect.compareFieldOperator(ctx, User, 'name', '$size', 3);
      }).toThrow('$size is not supported in the base SQL dialect');
    });

    it('compareFieldOperator $elemMatch throws for SQL', () => {
      const ctx = dialect.createContext();
      expect(() => {
        // Use 'as any' on dialect since $elemMatch type is 'never' for non-array fields
        (dialect as any).compareFieldOperator(ctx, User, 'name', '$elemMatch', { foo: 'bar' });
      }).toThrow('$elemMatch is not supported in the base SQL dialect');
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
      } as any);
      expect(ctx.sql).toBe(" WHERE (kind->>'public')::boolean IS TRUE");
    });

    it('raw string in $or should not be prefixed', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $or: [raw('kind IS NULL'), raw("kind = '{}'")],
      } as any);
      expect(ctx.sql).toBe(" WHERE kind IS NULL OR kind = '{}'");
    });

    it('raw function in $and should still work (regression)', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [raw(() => 'custom_check(kind) = TRUE')],
      } as any);
      expect(ctx.sql).toBe(' WHERE custom_check(kind) = TRUE');
    });

    it('raw string in $and mixed with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        name: 'Acme',
        $and: [raw('kind IS NOT NULL')],
      } as any);
      expect(ctx.sql).toBe(' WHERE `name` = ? AND kind IS NOT NULL');
      expect(ctx.values).toEqual(['Acme']);
    });
  });

  // ─── JSONB dot-notation ────────────────────────────────────────────
  describe('JSONB dot-notation', () => {
    it('simple equality', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': 1 } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') = ?");
      expect(ctx.values).toEqual([1]);
    });

    it('with $eq operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $eq: 'active' } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') = ?");
      expect(ctx.values).toEqual(['active']);
    });

    it('with $ne operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $ne: 1 } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') <> ?");
      expect(ctx.values).toEqual([1]);
    });

    it('with $gt numeric operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $gt: 0 } } as any);
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) > ?");
      expect(ctx.values).toEqual([0]);
    });

    it('with $lt numeric operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $lt: 100 } } as any);
      expect(ctx.sql).toBe(" WHERE CAST((`kind`->>'public') AS NUMERIC) < ?");
      expect(ctx.values).toEqual([100]);
    });

    it('with multiple numeric operators', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $gte: 0, $lte: 1 } } as any);
      expect(ctx.sql).toBe(
        " WHERE (CAST((`kind`->>'public') AS NUMERIC) >= ? AND CAST((`kind`->>'public') AS NUMERIC) <= ?)",
      );
      expect(ctx.values).toEqual([0, 1]);
    });

    it('with $like string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $like: '%test%' } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') LIKE ?");
      expect(ctx.values).toEqual(['%test%']);
    });

    it('with $startsWith string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $startsWith: 'pre' } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') LIKE ?");
      expect(ctx.values).toEqual(['pre%']);
    });

    it('with $endsWith string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $endsWith: 'fix' } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') LIKE ?");
      expect(ctx.values).toEqual(['%fix']);
    });

    it('with $includes string operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $includes: 'mid' } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') LIKE ?");
      expect(ctx.values).toEqual(['%mid%']);
    });

    it('with $regex operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $regex: '^test' } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') REGEXP ?");
      expect(ctx.values).toEqual(['^test']);
    });

    it('with $in operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $in: ['a', 'b', 'c'] } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') IN (?, ?, ?)");
      expect(ctx.values).toEqual(['a', 'b', 'c']);
    });

    it('with $nin operator', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $nin: ['x', 'y'] } } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') NOT IN (?, ?)");
      expect(ctx.values).toEqual(['x', 'y']);
    });

    it('with array shorthand (maps to $in)', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': ['a', 'b'] } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') IN (?, ?)");
      expect(ctx.values).toEqual(['a', 'b']);
    });

    it('deep nested path (two levels)', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.theme.color': 'red' } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'theme.color') = ?");
      expect(ctx.values).toEqual(['red']);
    });

    it('combined with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { name: 'Acme', 'kind.public': 1 } as any);
      expect(ctx.sql).toBe(" WHERE `name` = ? AND (`kind`->>'public') = ?");
      expect(ctx.values).toEqual(['Acme', 1]);
    });

    it('combined with $and', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        $and: [{ 'kind.public': { $eq: 1 } } as any, { 'kind.active': { $ne: 0 } } as any],
      } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') = ? AND (`kind`->>'active') <> ?");
      expect(ctx.values).toEqual([1, 0]);
    });

    it('multiple dot-paths on same column', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, {
        'kind.public': 1,
        'kind.active': { $ne: 0 },
      } as any);
      expect(ctx.sql).toBe(" WHERE (`kind`->>'public') = ? AND (`kind`->>'active') <> ?");
      expect(ctx.values).toEqual([1, 0]);
    });
  });

  // ─── Relation filtering ───────────────────────────────────────────
  describe('relation filtering', () => {
    it('ManyToMany with simple id equality', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { id: 5 } } as any);
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `Tag`.`id` FROM `Tag` WHERE `Tag`.`id` = ?))',
      );
      expect(ctx.values).toEqual([5]);
    });

    it('ManyToMany with operator filter', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { name: { $like: '%react%' } } } as any);
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `Tag`.`id` FROM `Tag` WHERE `Tag`.`name` LIKE ?))',
      );
      expect(ctx.values).toEqual(['%react%']);
    });

    it('ManyToMany with multiple conditions on related entity', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { tags: { id: 1, name: 'urgent' } } as any);
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.sql).toContain('`Tag`.`id` = ?');
      expect(ctx.sql).toContain('`Tag`.`name` = ?');
      expect(ctx.values).toEqual([1, 'urgent']);
    });

    it('OneToMany with simple filter', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { name: 'kg' } } as any);
      // MeasureUnitCategory has softDelete, so parent query adds AND `deletedAt` IS NULL
      expect(ctx.sql).toBe(
        ' WHERE EXISTS (SELECT 1 FROM `MeasureUnit` WHERE `MeasureUnit`.`categoryId` = `MeasureUnitCategory`.`id` AND `MeasureUnit`.`name` = ?) AND `deletedAt` IS NULL',
      );
      expect(ctx.values).toEqual(['kg']);
    });

    it('inner EXISTS subquery should not leak softDelete conditions', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, MeasureUnitCategory, { measureUnits: { name: 'kg' } } as any);
      const existsPart = ctx.sql.split('EXISTS (')[1].split(')')[0];
      // softDelete condition should NOT appear inside the EXISTS subquery
      expect(existsPart).not.toContain('deletedAt');
    });

    it('combined with regular field', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Item, { companyId: 1, tags: { name: 'urgent' } } as any);
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
      } as any);
      expect(ctx.sql).toContain('`companyId` = ?');
      expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM `ItemTag`');
      expect(ctx.sql).toContain('code IS NOT NULL');
      expect(ctx.values).toEqual([1, 'test']);
    });
  });

  // ─── Branch coverage: error & fallback paths ─────────────────────
  describe('edge cases', () => {
    it('unsupported JSON operator throws TypeError', () => {
      const ctx = dialect.createContext();
      expect(() => dialect.where(ctx, Company, { 'kind.public': { $unsupported: 1 } } as any)).toThrow(
        'JSON field condition does not support operator: $unsupported',
      );
    });

    it('base dialect $ilike uses LOWER() fallback', () => {
      const ctx = dialect.createContext();
      dialect.where(ctx, Company, { 'kind.public': { $ilike: '%Active%' } } as any);
      expect(ctx.sql).toBe(" WHERE LOWER((`kind`->>'public')) LIKE ?");
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
        expect(() => dialect.where(ctx, Item, { tags: { id: 1 } } as any)).toThrow('has no references defined');
      } finally {
        tagRelation.references = originalRefs;
      }
    });
  });
});
