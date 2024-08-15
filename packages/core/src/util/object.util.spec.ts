import { clone, hasKeys, getKeys } from './object.util.js';

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
  expect(getKeys(undefined)).toEqual([]);
  expect(getKeys(null)).toEqual([]);
  expect(getKeys({})).toEqual([]);
  expect(getKeys({ a: 1 })).toEqual(['a']);
});
