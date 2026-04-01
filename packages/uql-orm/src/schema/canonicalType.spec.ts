import { describe, expect, it } from 'vitest';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MongodbNativeDialect } from '../mongo/mongodbNativeDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { BetterSqlite3Dialect } from '../sqlite/betterSqlite3Dialect.js';
import {
  areTypesEqual,
  canonicalToColumnType,
  canonicalToSql,
  canonicalToTypeScript,
  fieldOptionsToCanonical,
  isBreakingTypeChange,
  sqlToCanonical,
} from './canonicalType.js';
import type { CanonicalType } from './types.js';

const pg = new PostgresDialect();
const mysql = new MySqlDialect();
const maria = new MariaDialect();
const sqlite = new BetterSqlite3Dialect();
const mongo = new MongodbNativeDialect();

describe('canonicalType', () => {
  describe('sqlToCanonical', () => {
    it('should parse integer types', () => {
      expect(sqlToCanonical('INT')).toEqual({ category: 'integer' });
      expect(sqlToCanonical('integer')).toEqual({ category: 'integer' });
      expect(sqlToCanonical('BIGINT')).toEqual({ category: 'integer', size: 'big' });
      expect(sqlToCanonical('smallint')).toEqual({ category: 'integer', size: 'small' });
      expect(sqlToCanonical('tinyint')).toEqual({ category: 'integer', size: 'tiny' });
      expect(sqlToCanonical('smallserial')).toEqual({ category: 'integer', size: 'small' });
    });

    it('should parse string types with length', () => {
      expect(sqlToCanonical('VARCHAR(255)')).toEqual({ category: 'string', length: 255 });
      expect(sqlToCanonical('char(10)')).toEqual({ category: 'string', length: 10 });
      expect(sqlToCanonical('TEXT')).toEqual({ category: 'string', size: 'small' });
    });

    it('should parse decimal types with precision and scale', () => {
      expect(sqlToCanonical('DECIMAL(10, 2)')).toEqual({ category: 'decimal', precision: 10, scale: 2 });
      expect(sqlToCanonical('numeric(5)')).toEqual({ category: 'decimal', precision: 5 });
    });

    it('should parse float types', () => {
      expect(sqlToCanonical('FLOAT')).toEqual({ category: 'float' });
      expect(sqlToCanonical('DOUBLE')).toEqual({ category: 'float', size: 'big' });
      expect(sqlToCanonical('real')).toEqual({ category: 'float' });
    });

    it('should parse boolean types', () => {
      expect(sqlToCanonical('BOOLEAN')).toEqual({ category: 'boolean' });
      expect(sqlToCanonical('bool')).toEqual({ category: 'boolean' });
    });

    it('should parse date/time types', () => {
      expect(sqlToCanonical('DATE')).toEqual({ category: 'date' });
      expect(sqlToCanonical('TIME')).toEqual({ category: 'time' });
      expect(sqlToCanonical('TIMESTAMP')).toEqual({ category: 'timestamp' });
      expect(sqlToCanonical('timestamptz')).toEqual({ category: 'timestamp', withTimezone: true });
      expect(sqlToCanonical('datetime')).toEqual({ category: 'timestamp' });
    });

    it('should parse JSON types', () => {
      expect(sqlToCanonical('JSON')).toEqual({ category: 'json' });
      expect(sqlToCanonical('JSONB')).toEqual({ category: 'json' });
    });

    it('should parse UUID types', () => {
      expect(sqlToCanonical('UUID')).toEqual({ category: 'uuid' });
    });

    it('should parse blob types', () => {
      expect(sqlToCanonical('BLOB')).toEqual({ category: 'blob' });
      expect(sqlToCanonical('bytea')).toEqual({ category: 'blob' });
    });

    it('should parse vector types', () => {
      expect(sqlToCanonical('VECTOR(1536)')).toEqual({ category: 'vector', length: 1536 });
      expect(sqlToCanonical('HALFVEC(1536)')).toEqual({ category: 'halfvec', length: 1536 });
      expect(sqlToCanonical('SPARSEVEC(4000)')).toEqual({ category: 'sparsevec', length: 4000 });
    });

    it('should handle unknown types as raw', () => {
      const result = sqlToCanonical('CUSTOM_TYPE');
      expect(result.raw).toBe('CUSTOM_TYPE');
    });

    it('should detect UNSIGNED modifier', () => {
      const result = sqlToCanonical('INT UNSIGNED');
      expect(result.unsigned).toBe(true);
    });
  });

  describe('canonicalToSql', () => {
    it('should convert integer to SQL for postgres', () => {
      expect(canonicalToSql({ category: 'integer' }, pg)).toBe('INTEGER');
      expect(canonicalToSql({ category: 'integer', size: 'big' }, pg)).toBe('BIGINT');
    });

    it('should convert string to SQL for mysql', () => {
      expect(canonicalToSql({ category: 'string', length: 100 }, mysql)).toBe('VARCHAR(100)');
      expect(canonicalToSql({ category: 'string' }, mysql)).toBe('VARCHAR(255)');
    });

    it('should convert decimal to SQL with precision', () => {
      expect(canonicalToSql({ category: 'decimal', precision: 10, scale: 2 }, pg)).toBe('NUMERIC(10, 2)');
    });

    it('should convert timestamp with timezone for postgres', () => {
      expect(canonicalToSql({ category: 'timestamp', withTimezone: true }, pg)).toBe('TIMESTAMPTZ');
    });

    it('should handle raw types', () => {
      expect(canonicalToSql({ category: 'string', raw: 'CUSTOM' }, pg)).toBe('CUSTOM');
    });

    it('should add UNSIGNED for mysql integers', () => {
      expect(canonicalToSql({ category: 'integer', unsigned: true }, mysql)).toBe('INT UNSIGNED');
    });

    it('should convert vector types with dimensions for postgres', () => {
      expect(canonicalToSql({ category: 'vector', length: 768 }, pg)).toBe('VECTOR(768)');
      expect(canonicalToSql({ category: 'halfvec', length: 1536 }, pg)).toBe('HALFVEC(1536)');
      expect(canonicalToSql({ category: 'sparsevec', length: 4000 }, pg)).toBe('SPARSEVEC(4000)');
    });

    it('should fall back halfvec/sparsevec to VECTOR for mariadb', () => {
      expect(canonicalToSql({ category: 'vector', length: 768 }, maria)).toBe('VECTOR(768)');
      expect(canonicalToSql({ category: 'halfvec', length: 1536 }, maria)).toBe('VECTOR(1536)');
      expect(canonicalToSql({ category: 'sparsevec', length: 4000 }, maria)).toBe('VECTOR(4000)');
    });
  });

  describe('canonicalToTypeScript', () => {
    it('should convert to TypeScript types', () => {
      expect(canonicalToTypeScript({ category: 'integer' })).toBe('number');
      expect(canonicalToTypeScript({ category: 'string' })).toBe('string');
      expect(canonicalToTypeScript({ category: 'boolean' })).toBe('boolean');
      expect(canonicalToTypeScript({ category: 'timestamp' })).toBe('Date');
      expect(canonicalToTypeScript({ category: 'json' })).toBe('unknown');
      expect(canonicalToTypeScript({ category: 'uuid' })).toBe('string');
      expect(canonicalToTypeScript({ category: 'blob' })).toBe('Buffer');
      expect(canonicalToTypeScript({ category: 'vector' })).toBe('number[]');
      expect(canonicalToTypeScript({ category: 'halfvec' })).toBe('number[]');
      expect(canonicalToTypeScript({ category: 'sparsevec' })).toBe('number[]');
    });
  });

  describe('fieldOptionsToCanonical', () => {
    it('should use explicit columnType', () => {
      const result = fieldOptionsToCanonical({ columnType: 'varchar', length: 100 });
      expect(result.category).toBe('string');
      expect(result.length).toBe(100);
    });

    it('should infer from TypeScript type', () => {
      expect(fieldOptionsToCanonical({ type: String })).toEqual({ category: 'string', length: undefined });
      expect(fieldOptionsToCanonical({ type: Number })).toEqual({ category: 'integer', size: 'big' });
      expect(fieldOptionsToCanonical({ type: Boolean })).toEqual({ category: 'boolean' });
      expect(fieldOptionsToCanonical({ type: Date })).toEqual({ category: 'timestamp' });
      expect(fieldOptionsToCanonical({ type: BigInt })).toEqual({ category: 'integer', size: 'big' });
    });

    it('should detect decimal from precision/scale', () => {
      const result = fieldOptionsToCanonical({ type: Number, precision: 10, scale: 2 });
      expect(result.category).toBe('decimal');
    });

    it('should handle new type aliases via type', () => {
      expect(fieldOptionsToCanonical({ type: 'integer' }).category).toBe('integer');
      expect(fieldOptionsToCanonical({ type: 'tinyint' })).toEqual({ category: 'integer', size: 'tiny' });
      expect(fieldOptionsToCanonical({ type: 'bool' }).category).toBe('boolean');
      expect(fieldOptionsToCanonical({ type: 'datetime' }).category).toBe('timestamp');
      expect(fieldOptionsToCanonical({ type: 'smallserial' })).toEqual({ category: 'integer', size: 'small' });
    });

    it('should handle new type aliases via columnType', () => {
      expect(fieldOptionsToCanonical({ columnType: 'integer' }).category).toBe('integer');
      expect(fieldOptionsToCanonical({ columnType: 'tinyint' })).toEqual({ category: 'integer', size: 'tiny' });
      expect(fieldOptionsToCanonical({ columnType: 'bool' }).category).toBe('boolean');
      expect(fieldOptionsToCanonical({ columnType: 'datetime' }).category).toBe('timestamp');
      expect(fieldOptionsToCanonical({ columnType: 'smallserial' })).toEqual({ category: 'integer', size: 'small' });
    });

    it('should default to string', () => {
      expect(fieldOptionsToCanonical({}).category).toBe('string');
    });
  });

  describe('areTypesEqual', () => {
    it('should return true for identical types', () => {
      const type1: CanonicalType = { category: 'integer' };
      const type2: CanonicalType = { category: 'integer' };
      expect(areTypesEqual(type1, type2)).toBe(true);
    });

    it('should return false for different categories', () => {
      const type1: CanonicalType = { category: 'integer' };
      const type2: CanonicalType = { category: 'string' };
      expect(areTypesEqual(type1, type2)).toBe(false);
    });

    it('should compare string lengths', () => {
      expect(areTypesEqual({ category: 'string', length: 100 }, { category: 'string', length: 100 })).toBe(true);
      expect(areTypesEqual({ category: 'string', length: 100 }, { category: 'string', length: 200 })).toBe(false);
    });

    it('should treat undefined length as 255 for strings', () => {
      expect(areTypesEqual({ category: 'string' }, { category: 'string', length: 255 })).toBe(true);
    });

    it('should compare decimal precision and scale', () => {
      expect(
        areTypesEqual(
          { category: 'decimal', precision: 10, scale: 2 },
          { category: 'decimal', precision: 10, scale: 2 },
        ),
      ).toBe(true);
      expect(
        areTypesEqual(
          { category: 'decimal', precision: 10, scale: 2 },
          { category: 'decimal', precision: 10, scale: 4 },
        ),
      ).toBe(false);
    });

    it('should compare timezone for timestamps', () => {
      expect(
        areTypesEqual({ category: 'timestamp', withTimezone: true }, { category: 'timestamp', withTimezone: true }),
      ).toBe(true);
      expect(areTypesEqual({ category: 'timestamp', withTimezone: true }, { category: 'timestamp' })).toBe(false);
    });

    it('should compare unsigned flag', () => {
      expect(areTypesEqual({ category: 'integer', unsigned: true }, { category: 'integer', unsigned: true })).toBe(
        true,
      );
      expect(areTypesEqual({ category: 'integer', unsigned: true }, { category: 'integer' })).toBe(false);
    });

    it('should compare size variants', () => {
      expect(areTypesEqual({ category: 'integer', size: 'big' }, { category: 'integer', size: 'big' })).toBe(true);
      expect(areTypesEqual({ category: 'integer', size: 'big' }, { category: 'integer', size: 'small' })).toBe(false);
    });
  });

  describe('isBreakingTypeChange', () => {
    it('should detect category change as breaking', () => {
      expect(isBreakingTypeChange({ category: 'integer' }, { category: 'string' })).toBe(true);
    });

    it('should detect size reduction as breaking', () => {
      expect(isBreakingTypeChange({ category: 'integer', size: 'big' }, { category: 'integer', size: 'small' })).toBe(
        true,
      );
    });

    it('should not flag size increase as breaking', () => {
      expect(isBreakingTypeChange({ category: 'integer', size: 'small' }, { category: 'integer', size: 'big' })).toBe(
        false,
      );
    });

    it('should detect string length reduction as breaking', () => {
      expect(isBreakingTypeChange({ category: 'string', length: 255 }, { category: 'string', length: 100 })).toBe(true);
    });

    it('should detect precision reduction as breaking', () => {
      expect(isBreakingTypeChange({ category: 'decimal', precision: 10 }, { category: 'decimal', precision: 5 })).toBe(
        true,
      );
    });

    it('should detect scale reduction as breaking', () => {
      expect(isBreakingTypeChange({ category: 'decimal', scale: 4 }, { category: 'decimal', scale: 2 })).toBe(true);
    });
  });

  describe('canonicalToColumnType', () => {
    it('should convert to UQL ColumnType', () => {
      expect(canonicalToColumnType({ category: 'integer' })).toBe('int');
      expect(canonicalToColumnType({ category: 'integer', size: 'big' })).toBe('bigint');
      expect(canonicalToColumnType({ category: 'integer', size: 'small' })).toBe('smallint');
      expect(canonicalToColumnType({ category: 'float' })).toBe('float');
      expect(canonicalToColumnType({ category: 'float', size: 'big' })).toBe('double');
      expect(canonicalToColumnType({ category: 'decimal' })).toBe('decimal');
      expect(canonicalToColumnType({ category: 'string', length: 100 })).toBe('varchar');
      expect(canonicalToColumnType({ category: 'string' })).toBe('text');
      expect(canonicalToColumnType({ category: 'boolean' })).toBe('boolean');
      expect(canonicalToColumnType({ category: 'date' })).toBe('date');
      expect(canonicalToColumnType({ category: 'time' })).toBe('time');
      expect(canonicalToColumnType({ category: 'timestamp' })).toBe('timestamp');
      expect(canonicalToColumnType({ category: 'timestamp', withTimezone: true })).toBe('timestamptz');
      expect(canonicalToColumnType({ category: 'json' })).toBe('jsonb');
      expect(canonicalToColumnType({ category: 'uuid' })).toBe('uuid');
      expect(canonicalToColumnType({ category: 'blob' })).toBe('bytea');
      expect(canonicalToColumnType({ category: 'vector' })).toBe('vector');
      expect(canonicalToColumnType({ category: 'halfvec' })).toBe('halfvec');
      expect(canonicalToColumnType({ category: 'sparsevec' })).toBe('sparsevec');
    });
  });

  describe('canonicalToSql edge cases', () => {
    it('should format string for mongodb dialect', () => {
      expect(canonicalToSql({ category: 'string', length: 100 }, mongo)).toBe('VARCHAR(100)');
      expect(canonicalToSql({ category: 'string' }, mongo)).toBe('VARCHAR(255)');
    });

    it('should format string with size variants for mysql', () => {
      expect(canonicalToSql({ category: 'string', size: 'tiny' }, mysql)).toBe('TINYTEXT');
      expect(canonicalToSql({ category: 'string', size: 'small' }, mysql)).toBe('TEXT');
      expect(canonicalToSql({ category: 'string', size: 'medium' }, mysql)).toBe('MEDIUMTEXT');
      expect(canonicalToSql({ category: 'string', size: 'big' }, mysql)).toBe('LONGTEXT');
    });

    it('should format string for sqlite', () => {
      expect(canonicalToSql({ category: 'string', length: 100 }, sqlite)).toBe('TEXT');
    });

    it('should format string without length for postgres', () => {
      expect(canonicalToSql({ category: 'string' }, pg)).toBe('TEXT');
    });

    it('should format decimal without precision for postgres', () => {
      expect(canonicalToSql({ category: 'decimal' }, pg)).toBe('NUMERIC');
    });

    it('should format decimal with precision only', () => {
      expect(canonicalToSql({ category: 'decimal', precision: 8 }, pg)).toBe('NUMERIC(8)');
    });

    it('should format integer with size for mysql', () => {
      expect(canonicalToSql({ category: 'integer', size: 'tiny' }, mysql)).toBe('TINYINT');
      expect(canonicalToSql({ category: 'integer', size: 'medium' }, mysql)).toBe('MEDIUMINT');
    });
  });
});
