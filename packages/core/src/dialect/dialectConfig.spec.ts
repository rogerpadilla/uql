import { describe, expect, it } from 'vitest';
import { DIALECT_CONFIG, getDialectConfig } from './dialectConfig.js';

describe('dialectConfig', () => {
  it('should have configuration for each dialect', () => {
    expect(DIALECT_CONFIG.postgres).toBeDefined();
    expect(DIALECT_CONFIG.mysql).toBeDefined();
    expect(DIALECT_CONFIG.mariadb).toBeDefined();
    expect(DIALECT_CONFIG.sqlite).toBeDefined();
    expect(DIALECT_CONFIG.mongodb).toBeDefined();
  });

  it('should return the correct configuration for postgres', () => {
    const config = getDialectConfig('postgres');
    expect(config.quoteChar).toBe('"');
    expect(config.serialPrimaryKey).toContain('IDENTITY');
    expect(config.alterColumnSyntax).toBe('ALTER COLUMN');
  });

  it('should return the correct configuration for mysql', () => {
    const config = getDialectConfig('mysql');
    expect(config.quoteChar).toBe('`');
    expect(config.serialPrimaryKey).toContain('AUTO_INCREMENT');
    expect(config.alterColumnSyntax).toBe('MODIFY COLUMN');
  });

  it('should return the correct configuration for mariadb', () => {
    const config = getDialectConfig('mariadb');
    expect(config.quoteChar).toBe('`');
    expect(config.serialPrimaryKey).toContain('AUTO_INCREMENT');
    expect(config.alterColumnSyntax).toBe('MODIFY COLUMN');
  });

  it('should return the correct configuration for sqlite', () => {
    const config = getDialectConfig('sqlite');
    expect(config.quoteChar).toBe('`');
    expect(config.serialPrimaryKey).toContain('AUTOINCREMENT');
    expect(config.alterColumnSyntax).toBe('none');
  });

  it('should return the correct configuration for mongodb', () => {
    const config = getDialectConfig('mongodb');
    expect(config.quoteChar).toBe('"');
    expect(config.alterColumnSyntax).toBe('none');
  });
});
