import { describe, expect, it } from 'vitest';
import { DefaultNamingStrategy } from './defaultNamingStrategy.js';

describe('DefaultNamingStrategy', () => {
  const strategy = new DefaultNamingStrategy();

  it('should name a table as its class', () => {
    expect(strategy.tableName('UserProfile')).toBe('UserProfile');
  });

  it('should name a column as its property', () => {
    expect(strategy.columnName('firstName')).toBe('firstName');
  });

  it('should name a join table after both sides', () => {
    expect(strategy.joinTableName('User', 'Role')).toBe('User_Role');
  });
});
