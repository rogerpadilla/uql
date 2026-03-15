import { describe, expect, it } from 'vitest';
import { User } from '../test/index.js';
import { CockroachDialect } from './cockroachDialect.js';

describe('CockroachDialect', () => {
  const dialect = new CockroachDialect();

  it('should use cockroachdb identifier', () => {
    expect(dialect.dialect).toBe('cockroachdb');
  });

  it('upsert should support xmax just like postgres', () => {
    const ctx = dialect.createContext();
    dialect.upsert(
      ctx,
      User,
      { email: true, companyId: true },
      {
        id: 1,
        name: 'Test',
        email: 'test@example.com',
        companyId: 1,
      },
    );
    expect(ctx.sql).toBe(
      'INSERT INTO "User" ("id", "name", "email", "companyId", "createdAt") VALUES ($2, $3, $4, $5, $6) ON CONFLICT ("email", "companyId") DO UPDATE SET "id" = EXCLUDED."id", "name" = EXCLUDED."name", "updatedAt" = $1 RETURNING "id" "id", (xmax = 0) AS "_created"',
    );
  });
});
