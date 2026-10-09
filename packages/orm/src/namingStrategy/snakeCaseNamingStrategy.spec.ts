import { describe, expect, it } from 'vitest';
import { SnakeCaseNamingStrategy } from './snakeCaseNamingStrategy.js';

describe('SnakeCaseNamingStrategy', () => {
  const strategy = new SnakeCaseNamingStrategy();

  it('should name a table in snake_case', () => {
    expect(strategy.tableName('UserProfile')).toBe('user_profile');
  });

  it('should name a column in snake_case', () => {
    expect(strategy.columnName('firstName')).toBe('first_name');
  });
});
