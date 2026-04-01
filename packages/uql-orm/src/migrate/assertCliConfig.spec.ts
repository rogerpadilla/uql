import { describe, expect, it } from 'vitest';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { assertCliConfig } from './assertCliConfig.js';

const minimalPool = {
  dialect: new SqliteDialect(),
  getQuerier: async () => ({}),
  transaction: async () => {},
  withQuerier: async () => {},
  end: async () => {},
};

describe('assertCliConfig', () => {
  it('accepts a valid config', () => {
    const config = { pool: minimalPool };
    expect(() => assertCliConfig(config)).not.toThrow();
  });

  it('throws when config is not an object', () => {
    expect(() => assertCliConfig(null)).toThrow(/non-null object/);
  });

  it('throws when pool is missing', () => {
    expect(() => assertCliConfig({})).toThrow(/Config\.pool/);
  });

  it('throws when dialect.dialectName is not a string', () => {
    expect(() =>
      assertCliConfig({
        pool: {
          ...minimalPool,
          dialect: {},
        },
      }),
    ).toThrow(/dialect\.dialectName/);
  });

  it('throws when end is present but not a function', () => {
    expect(() =>
      assertCliConfig({
        pool: { ...minimalPool, end: 'nope' as any },
      }),
    ).toThrow(/pool\.end/);
  });
});
