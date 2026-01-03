import { describe, expect, it } from 'vitest';
import { SnakeCaseNamingStrategy } from './snakeCaseNamingStrategy.js';

describe('SnakeCaseNamingStrategy', () => {
  const strategy = new SnakeCaseNamingStrategy();

  it('tableName', () => {
    expect(strategy.tableName('UserProfile')).toBe('user_profile');
  });

  it('columnName', () => {
    expect(strategy.columnName('firstName')).toBe('first_name');
  });

  it('joinTableName', () => {
    expect(strategy.joinTableName('User', 'Role')).toBe('User_Role');
  });
});
