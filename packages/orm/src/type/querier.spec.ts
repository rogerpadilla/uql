import { describe, expect, it, vi } from 'vitest';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier } from '../test/index.js';
import { isSqlQuerier } from './querier.js';

const sqlStub = createMockQuerier({ all: vi.fn(), run: vi.fn(), dialect: new PostgresDialect() });

const mongoLikeStub = createMockQuerier({ all: vi.fn(), run: vi.fn(), dialect: new MongoDialect() });

const plainStub = createMockQuerier();

describe('isSqlQuerier', () => {
  it('should accept a querier whose dialect conforms to the SqlQueryDialect interface', () => {
    expect(isSqlQuerier(sqlStub)).toBe(true);
  });

  it('should reject a querier whose dialect lacks escapeIdChar', () => {
    expect(isSqlQuerier(mongoLikeStub)).toBe(false);
  });

  it('should reject a querier without raw SQL methods', () => {
    expect(isSqlQuerier(plainStub)).toBe(false);
  });
});
