import { describe, expect, it } from 'vitest';
import type { FieldOptions } from '../type/index.js';
import { isAutoIncrement, isBooleanType, isNumericType } from './field.util.js';

describe('isNumericType', () => {
  it('should return true for Number constructor', () => {
    expect(isNumericType(Number)).toBe(true);
  });

  it('should return true for BigInt constructor', () => {
    expect(isNumericType(BigInt)).toBe(true);
  });

  it('should return true for numeric string types', () => {
    const numericTypes = [
      'int',
      'integer',
      'tinyint',
      'bigint',
      'smallint',
      'decimal',
      'numeric',
      'float',
      'real',
      'double',
      'serial',
      'smallserial',
      'bigserial',
    ];
    for (const type of numericTypes) {
      expect(isNumericType(type)).toBe(true);
    }
  });

  it('should return true for mixed case numeric string types', () => {
    expect(isNumericType('INT')).toBe(true);
    expect(isNumericType('Decimal')).toBe(true);
  });

  it('should return false for non-numeric types', () => {
    const nonNumericTypes = ['boolean', 'string', 'varchar', 'text', 'uuid', 'date', 'json', 'blob'];
    for (const type of nonNumericTypes) {
      expect(isNumericType(type)).toBe(false);
    }
  });

  it('should return false for invalid inputs', () => {
    expect(isNumericType(null)).toBe(false);
    expect(isNumericType(undefined)).toBe(false);
    expect(isNumericType({})).toBe(false);
    expect(isNumericType(Boolean)).toBe(false);
    expect(isNumericType(Date)).toBe(false);
  });
});

describe('isBooleanType', () => {
  it('should return true for the Boolean constructor and both boolean string types', () => {
    expect(isBooleanType(Boolean)).toBe(true);
    expect(isBooleanType('bool')).toBe(true);
    expect(isBooleanType('boolean')).toBe(true);
    expect(isBooleanType('BOOLEAN')).toBe(true);
  });

  it('should return false for anything else', () => {
    // `tinyint` in particular: MySQL stores a boolean as TINYINT(1), but a field declaring the column
    // type asked for an integer, and reading it back as `true`/`false` would be a different type.
    for (const type of ['tinyint', 'int', 'string', 'json']) {
      expect(isBooleanType(type)).toBe(false);
    }
    expect(isBooleanType(Number)).toBe(false);
    expect(isBooleanType(null)).toBe(false);
    expect(isBooleanType(undefined)).toBe(false);
    expect(isBooleanType({})).toBe(false);
  });
});

describe('isAutoIncrement', () => {
  it('should return true for numeric primary keys without custom handlers', () => {
    const field: FieldOptions = { type: Number };
    expect(isAutoIncrement(field, true)).toBe(true);
    expect(isAutoIncrement({ type: 'int' }, true)).toBe(true);
    expect(isAutoIncrement({ type: 'integer' }, true)).toBe(true);
  });

  it('should return true for serial/smallserial columnType', () => {
    expect(isAutoIncrement({ columnType: 'serial' }, false)).toBe(true);
    expect(isAutoIncrement({ columnType: 'bigserial' }, false)).toBe(true);
    expect(isAutoIncrement({ columnType: 'smallserial' }, false)).toBe(true);
  });

  it('should return false given a non-primary key', () => {
    const field: FieldOptions = { type: Number };
    expect(isAutoIncrement(field, false)).toBe(false);
  });

  it('should return false given a non-numeric type', () => {
    expect(isAutoIncrement({ type: String }, true)).toBe(false);
    expect(isAutoIncrement({ type: Boolean }, true)).toBe(false);
    expect(isAutoIncrement({ type: 'boolean' }, true)).toBe(false);
    expect(isAutoIncrement({ type: 'varchar' }, true)).toBe(false);
  });

  it('should return false if autoIncrement is explicitly false', () => {
    const field: FieldOptions = { type: Number, autoIncrement: false };
    expect(isAutoIncrement(field, true)).toBe(false);
  });

  it('should return false if onInsert is defined', () => {
    const field: FieldOptions = { type: Number, onInsert: () => 1 };
    expect(isAutoIncrement(field, true)).toBe(false);
  });

  it('should return false if columnType is manually defined', () => {
    const field: FieldOptions = { type: Number, columnType: 'int' };
    expect(isAutoIncrement(field, true)).toBe(false);
  });
});
