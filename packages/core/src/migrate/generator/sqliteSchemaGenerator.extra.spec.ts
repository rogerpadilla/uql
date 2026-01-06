import { describe, expect, it } from 'vitest';
import { SqliteSchemaGenerator } from './sqliteSchemaGenerator.js';

describe('SqliteSchemaGenerator (extra coverage)', () => {
  const generator = new SqliteSchemaGenerator();

  it('mapColumnType various types', () => {
    expect(generator.mapColumnType('decimal', {})).toBe('REAL');
    expect(generator.mapColumnType('float', {})).toBe('REAL');
    expect(generator.mapColumnType('float4', {})).toBe('REAL');
    expect(generator.mapColumnType('float8', {})).toBe('REAL');
    expect(generator.mapColumnType('double', {})).toBe('REAL');
    expect(generator.mapColumnType('double precision', {})).toBe('REAL');
    expect(generator.mapColumnType('real', {})).toBe('REAL');
    expect(generator.mapColumnType('boolean', {})).toBe('INTEGER');
    expect(generator.mapColumnType('timestamptz', {})).toBe('TEXT');
    expect(generator.mapColumnType('blob', {})).toBe('BLOB');
    expect(generator.mapColumnType('bytea', {})).toBe('BLOB');
    expect(generator.mapColumnType('vector', {})).toBe('TEXT');
    expect(generator.mapColumnType('unknown' as any, {})).toBe('TEXT');
  });

  it('generateDropIndex', () => {
    expect(generator.generateDropIndex('t', 'idx')).toBe('DROP INDEX IF EXISTS `idx`;');
  });

  it('formatDefaultValue for boolean', () => {
    expect(generator.formatDefaultValue(true)).toBe('1');
    expect(generator.formatDefaultValue(false)).toBe('0');
  });
});
