import { expect, it } from 'vitest';
import { clone, getKeys, hasKeys } from './object.util.js';

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
