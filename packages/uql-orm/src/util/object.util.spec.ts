import { describe, expect, it } from 'vitest';
import { clone, getKeys, hasKeys, isScalarId } from './object.util.js';

it('clone', () => {
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

it('hasKeys', () => {
  expect(hasKeys({})).toBe(false);
  expect(hasKeys({ a: 1 })).toBe(true);
});

it('getKeys', () => {
  expect(getKeys(undefined as any)).toEqual([]);
  expect(getKeys(null as any)).toEqual([]);
  expect(getKeys({})).toEqual([]);
  expect(getKeys({ a: 1 })).toEqual(['a']);
});

describe('isScalarId', () => {
  it.each([[1], ['a'], [1n], [true], [null], [undefined]])('takes %p for a value, not a set of columns', (value) => {
    expect(isScalarId(value)).toBe(true);
  });

  /** The object ids a driver deals in: they address a row by themselves, whatever their prototype. */
  it('takes the object values a column can hold', () => {
    expect(isScalarId(new Date())).toBe(true);
    expect(isScalarId(new Uint8Array([1]))).toBe(true);
    expect(isScalarId({ toHexString: () => 'abc' })).toBe(false);
    expect(isScalarId(Object.assign(Object.create({ toHexString: () => 'abc' }), { buffer: 1 }))).toBe(true);
  });

  /** A plain object names columns - a `$where` map, or a composite key's id - and a list is a list of those. */
  it('leaves a plain object and an array to be read as columns', () => {
    expect(isScalarId({ studentId: 1 })).toBe(false);
    expect(isScalarId({})).toBe(false);
    expect(isScalarId([1, 2])).toBe(false);
    // What a query-string parser hands back (`qs`, express's `req.params`): still a map of columns.
    expect(isScalarId(Object.assign(Object.create(null), { studentId: 1 }))).toBe(false);
  });
});
