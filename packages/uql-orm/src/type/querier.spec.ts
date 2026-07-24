import { describe, expect, it } from 'vitest';
import type { Querier } from './querier.js';
import { isSqlQuerier } from './querier.js';

const sqlStub = {
  all: async () => [],
  run: async () => ({}),
  dialect: { escapeIdChar: '"' },
} as unknown as Querier;

const mongoLikeStub = {
  all: async () => [],
  run: async () => ({}),
  dialect: {},
} as unknown as Querier;

const plainStub = {} as Querier;

describe('isSqlQuerier', () => {
  it('accepts a querier whose dialect conforms to the SqlQueryDialect interface', () => {
    expect(isSqlQuerier(sqlStub)).toBe(true);
  });

  it('rejects a querier whose dialect lacks escapeIdChar', () => {
    expect(isSqlQuerier(mongoLikeStub)).toBe(false);
  });

  it('rejects a querier without raw SQL methods', () => {
    expect(isSqlQuerier(plainStub)).toBe(false);
  });
});
