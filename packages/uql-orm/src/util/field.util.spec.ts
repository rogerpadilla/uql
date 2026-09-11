import { describe, expect, it } from 'vitest';
import type { FieldOptions } from '../type/index.js';
import { columnFamily, isAutoIncrement, isIntegerColumn } from './field.util.js';

describe('columnFamily', () => {
  it('places the constructors', () => {
    expect(columnFamily(Number)).toBe('numeric');
    expect(columnFamily(BigInt)).toBe('numeric');
    expect(columnFamily(String)).toBe('string');
    expect(columnFamily(Boolean)).toBe('boolean');
    expect(columnFamily(Date)).toBe('date');
  });

  it('places one type of each family, which is what the built lookup has to get right', () => {
    // Every type's placement is checked where it is written - each list `satisfies` its own column-type
    // union, and `UnplacedColumnType` refuses one left out - and cross-checked against the canonical
    // categories in `canonicalType.spec`. What is left for a test is the lookup built from that table.
    const oneOfEach = {
      decimal: 'numeric',
      uuid: 'string',
      timestamptz: 'date',
      jsonb: 'json',
      bytea: 'blob',
      bool: 'boolean',
      halfvec: 'vector',
    };
    for (const [type, family] of Object.entries(oneOfEach)) {
      expect([type, columnFamily(type)]).toEqual([type, family]);
    }
  });

  it('reads a column type in any case', () => {
    expect(columnFamily('INT')).toBe('numeric');
    expect(columnFamily('Decimal')).toBe('numeric');
    expect(columnFamily('BOOLEAN')).toBe('boolean');
  });

  it('places nothing else', () => {
    // `tinyint` is numeric in particular: MySQL stores a boolean as TINYINT(1), but a field declaring
    // that column type asked for an integer, and reading it back as `true`/`false` would be another type.
    expect(columnFamily('string')).toBe(undefined);
    expect(columnFamily('nonesuch')).toBe(undefined);
    expect(columnFamily(null)).toBe(undefined);
    expect(columnFamily(undefined)).toBe(undefined);
    expect(columnFamily({})).toBe(undefined);
  });
});

describe('isIntegerColumn', () => {
  it('reads a `Number` or `BigInt` with no scale as the BIGINT it is stored as', () => {
    expect(isIntegerColumn({ type: Number })).toBe(true);
    expect(isIntegerColumn({ type: BigInt })).toBe(true);
    expect(isIntegerColumn({ type: Number, precision: 12, scale: 2 })).toBe(false);
  });

  it('reads a declared column type over the logical one', () => {
    expect(isIntegerColumn({ type: Number, columnType: 'smallint' })).toBe(true);
    expect(isIntegerColumn({ type: Number, columnType: 'double precision' })).toBe(false);
    expect(isIntegerColumn({ type: String, columnType: 'decimal' })).toBe(false);
    expect(isIntegerColumn({ type: 'BIGINT' as 'bigint' })).toBe(true);
  });
});

describe('isAutoIncrement', () => {
  it('should return true for numeric primary keys without custom handlers', () => {
    const field: FieldOptions = { type: Number };
    expect(isAutoIncrement(field, true)).toBe(true);
    expect(isAutoIncrement({ type: 'int' }, true)).toBe(true);
    expect(isAutoIncrement({ type: 'integer' }, true)).toBe(true);
  });

  // A key that states its width is still a key the database generates; one that states how it is
  // filled is not. The schema AST and this used to answer both of these differently.
  it('should generate a numeric key whatever width it declares', () => {
    expect(isAutoIncrement({ type: Number, columnType: 'int' }, true)).toBe(true);
    expect(isAutoIncrement({ type: Number, columnType: 'bigint' }, true)).toBe(true);
  });

  it('should not generate a key the application fills', () => {
    expect(isAutoIncrement({ type: Number, onInsert: () => 1 }, true)).toBe(false);
    expect(isAutoIncrement({ type: Number, autoIncrement: false }, true)).toBe(false);
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
});
