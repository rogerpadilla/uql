import { describe, expect, it } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';

describe('claimAlias', () => {
  const dialect = new PostgresDialect();

  it('should hand a table its own name while nothing else took it', () => {
    const ctx = dialect.createContext();

    expect(ctx.claimAlias('posts')).toBe('posts');
    expect(ctx.claimAlias('author')).toBe('author');
  });

  it('should suffix a name another table of the statement took, whatever its case', () => {
    const ctx = dialect.createContext();
    ctx.claimAlias('Company');

    expect(ctx.claimAlias('company')).toBe('company_2');
    expect(ctx.claimAlias('company')).toBe('company_3');
  });

  it('should never hand out the alias a correlated subquery compares against, whatever its case', () => {
    const ctx = dialect.createContext();

    expect(ctx.claimAlias('user', 'User')).toBe('user_2');
    expect(ctx.claimAlias('users', 'User')).toBe('users');
  });

  it('should keep a fragment unique within the statement it renders a part of', () => {
    const ctx = dialect.createContext();
    ctx.claimAlias('tags');

    expect(ctx.createFragment().claimAlias('tags')).toBe('tags_2');
    expect(ctx.claimAlias('tags')).toBe('tags_3');
  });
});

describe('inlineValues', () => {
  const dialect = new PostgresDialect();

  it('should bind a value by default', () => {
    const ctx = dialect.createContext();
    ctx.append('x = ').addValue(1);

    expect(ctx.sql).toBe('x = $1');
    expect(ctx.values).toEqual([1]);
  });

  it('should write a value as its literal and bind nothing', () => {
    const ctx = dialect.createContext({ inlineValues: true });
    ctx.append('x = ').addValue("it's");

    expect(ctx.sql).toBe("x = 'it''s'");
    expect(ctx.values).toEqual([]);
  });

  it('should inline the values of a fragment of an inline context', () => {
    const fragment = dialect.createContext({ inlineValues: true }).createFragment();
    fragment.addValue(1);

    expect(fragment.sql).toBe('1');
    expect(fragment.values).toEqual([]);
  });
});
