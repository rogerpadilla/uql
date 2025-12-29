import { DefaultNamingStrategy, SnakeCaseNamingStrategy } from './index.js';

describe('NamingStrategy', () => {
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

  describe('SnakeCaseNamingStrategy', () => {
    const strategy = new SnakeCaseNamingStrategy();

    it('tableName', () => {
      expect(strategy.tableName('UserProfile')).toBe('user_profile');
    });

    it('columnName', () => {
      expect(strategy.columnName('firstName')).toBe('first_name');
    });

    it('joinTableName', () => {
      expect(strategy.joinTableName('User', 'Role')).toBe('User_Role'); // Base implementation
    });
  });
});
