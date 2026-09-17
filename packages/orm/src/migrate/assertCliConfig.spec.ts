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
  it('should accept a valid config', () => {
    const config = { pool: minimalPool };
    expect(() => assertCliConfig(config)).not.toThrow();
  });

  it('should throw when config is not an object', () => {
    expect(() => assertCliConfig(null)).toThrow(/non-null object/);
  });

  it('should throw when pool is missing', () => {
    expect(() => assertCliConfig({})).toThrow(/Config\.pool/);
  });

  it('should throw when a pool method is not a function', () => {
    expect(() => assertCliConfig({ pool: { ...minimalPool, transaction: undefined } })).toThrow(
      'Config.pool.transaction must be a function',
    );
  });

  it('should throw when the dialect is missing', () => {
    expect(() => assertCliConfig({ pool: { ...minimalPool, dialect: undefined } })).toThrow(
      'Config.pool.dialect is required and must be an object',
    );
  });

  it('should throw when dialect.dialectName is not a string', () => {
    expect(() =>
      assertCliConfig({
        pool: {
          ...minimalPool,
          dialect: {},
        },
      }),
    ).toThrow(/dialect\.dialectName/);
  });

  it('should throw when end is present but not a function', () => {
    expect(() =>
      assertCliConfig({
        pool: { ...minimalPool, end: 'nope' },
      }),
    ).toThrow(/pool\.end/);
  });
});
