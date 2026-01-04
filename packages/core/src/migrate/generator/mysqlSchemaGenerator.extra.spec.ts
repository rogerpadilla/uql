import { describe, expect, it } from 'vitest';
import { MysqlSchemaGenerator } from './mysqlSchemaGenerator.js';

describe('MysqlSchemaGenerator (extra coverage)', () => {
  const generator = new MysqlSchemaGenerator();

  it('mapColumnType various types', () => {
    expect(generator.mapColumnType('int', {})).toBe('INT');
    expect(generator.mapColumnType('smallint', {})).toBe('SMALLINT');
    expect(generator.mapColumnType('float', {})).toBe('FLOAT');
    expect(generator.mapColumnType('double', {})).toBe('DOUBLE');
    expect(generator.mapColumnType('real', {})).toBe('DOUBLE');
    expect(generator.mapColumnType('decimal', { precision: 10 })).toBe('DECIMAL(10)');
    expect(generator.mapColumnType('decimal', {})).toBe('DECIMAL(10, 2)');
    expect(generator.mapColumnType('boolean', {})).toBe('TINYINT(1)');
    expect(generator.mapColumnType('char', {})).toBe('CHAR(1)');
    expect(generator.mapColumnType('uuid', {})).toBe('CHAR(36)');
    expect(generator.mapColumnType('date', {})).toBe('DATE');
    expect(generator.mapColumnType('time', {})).toBe('TIME');
    expect(generator.mapColumnType('timestamptz', {})).toBe('TIMESTAMP');
    expect(generator.mapColumnType('json', {})).toBe('JSON');
    expect(generator.mapColumnType('blob', {})).toBe('BLOB');
    expect(generator.mapColumnType('bytea', {})).toBe('BLOB');
    expect(generator.mapColumnType('vector', {})).toBe('JSON');
    expect(generator.mapColumnType('serial', {})).toBe('INT UNSIGNED AUTO_INCREMENT');
    expect(generator.mapColumnType('bigserial', {})).toBe('BIGINT UNSIGNED AUTO_INCREMENT');
    expect(generator.mapColumnType('unknown' as any, {})).toBe('TEXT');
  });

  it('generateColumnComment escaping', () => {
    expect(generator.generateColumnComment('t', 'c', "it's a comment")).toBe(" COMMENT 'it''s a comment'");
  });
});
