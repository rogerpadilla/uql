import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { User } from '../test/index.js';
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
});
