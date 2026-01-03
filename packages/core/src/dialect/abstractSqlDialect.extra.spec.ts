import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { User } from '../test/index.js';
import { AbstractSqlDialect } from './abstractSqlDialect.js';

class TestSqlDialect extends AbstractSqlDialect {
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
});
