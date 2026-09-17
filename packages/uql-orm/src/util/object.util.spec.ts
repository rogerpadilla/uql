import { describe, expect, it } from 'vitest';
import { defineField } from '../entity/index.js';
import { clone, entityName, getKeys, hasKeys, isScalarId } from './object.util.js';

describe('clone of what has nothing to copy', () => {
  it('should hand back a primitive and null as they are', () => {
    expect(clone(5)).toBe(5);
    expect(clone(null)).toBe(null);
  });
});

describe('entityName', () => {
  /** A meta registered through `@Field` alone never named its table, so it goes by its class. */
  it('should fall back to the class for a meta that names no table', () => {
    class Unnamed {}
    expect(entityName(defineField(Unnamed, 'label', { type: String }))).toBe('Unnamed');
  });
});

it('should clone objects and arrays deeply', () => {
  expect(clone({})).toEqual({});
  expect(clone({ a: 1 })).toEqual({ a: 1 });
  expect(clone([])).toEqual([]);
  expect(clone([{ a: 1 }])).toEqual([{ a: 1 }]);

  const source = [{ a: 1 }];
  const cloned = clone(source);

  expect(cloned[0]).not.toBe(source[0]);
  expect(cloned).not.toBe(source);
  expect(cloned[0]).toEqual(source[0]);
  expect(cloned).toEqual(source);
});

it('should tell whether an object has keys', () => {
  expect(hasKeys({})).toBe(false);
  expect(hasKeys({ a: 1 })).toBe(true);
});

it("should list an object's keys, and none for nothing", () => {
  expect(getKeys(undefined)).toEqual([]);
  expect(getKeys(null)).toEqual([]);
  expect(getKeys({})).toEqual([]);
  expect(getKeys({ a: 1 })).toEqual(['a']);
});

describe('isScalarId', () => {
  it.each([[1], ['a'], [1n], [true], [null], [undefined]])(
    'should take %p for a value, not a set of columns',
    (value) => {
      expect(isScalarId(value)).toBe(true);
    },
  );

  /** The object ids a driver deals in: they address a row by themselves, whatever their prototype. */
  it('should take the object values a column can hold', () => {
    expect(isScalarId(new Date())).toBe(true);
    expect(isScalarId(new Uint8Array([1]))).toBe(true);
    expect(isScalarId({ toHexString: () => 'abc' })).toBe(false);
    expect(isScalarId(Object.assign(Object.create({ toHexString: () => 'abc' }), { buffer: 1 }))).toBe(true);
  });

  /** A plain object names columns - a `$where` map, or a composite key's id - and a list is a list of those. */
  it('should leave a plain object and an array to be read as columns', () => {
    expect(isScalarId({ studentId: 1 })).toBe(false);
    expect(isScalarId({})).toBe(false);
    expect(isScalarId([1, 2])).toBe(false);
    // What a query-string parser hands back (`qs`, express's `req.params`): still a map of columns.
    expect(isScalarId(Object.assign(Object.create(null), { studentId: 1 }))).toBe(false);
  });
});
