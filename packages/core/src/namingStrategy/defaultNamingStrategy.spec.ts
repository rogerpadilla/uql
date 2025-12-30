import { describe, expect, it } from 'bun:test';
import { DefaultNamingStrategy } from './defaultNamingStrategy.js';

describe('DefaultNamingStrategy', () => {
  const strategy = new DefaultNamingStrategy();

  it('tableName', () => {
    expect(strategy.tableName('UserProfile')).toBe('UserProfile');
  });

  it('columnName', () => {
    expect(strategy.columnName('firstName')).toBe('firstName');
  });

  it('joinTableName', () => {
    expect(strategy.joinTableName('User', 'Role')).toBe('User_Role');
  });
});
