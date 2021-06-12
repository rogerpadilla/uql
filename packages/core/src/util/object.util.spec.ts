import { clone, hasKeys, getKeys } from './object.util';

it('clone', () => {
  expect(clone(undefined)).toBe(undefined);
  expect(clone(null)).toBe(null);
  expect(clone(20)).toBe(20);
  expect(clone('something')).toBe('something');
  expect(clone({})).toEqual({});
  expect(clone({ a: 1 })).toEqual({ a: 1 });
  expect(clone([])).toEqual([]);
  expect(clone([{ a: 1 }])).toEqual([{ a: 1 }]);

  const obj = [{ a: 1 }];
  const res = clone(obj);
  expect(res).not.toBe(obj);
  expect(res).toEqual(obj);
});

it('hasKeys', () => {
  expect(hasKeys({})).toBe(false);
  expect(hasKeys({ a: 1 })).toBe(true);
});

it('objectKeys', () => {
  expect(getKeys({})).toEqual([]);
  expect(getKeys({ a: 1 })).toEqual(['a']);
});
