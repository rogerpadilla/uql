import { kebabCase, lowerFirst, upperFirst } from './string.util.js';

it('kebabCase', () => {
  const res1 = kebabCase('SomeWordsAndMore');
  expect(res1).toBe('some-words-and-more');
  const res2 = kebabCase('someWordsAndMore');
  expect(res2).toBe('some-words-and-more');
});

it('upperFirst', () => {
  const res1 = upperFirst('id');
  expect(res1).toBe('Id');
  const res2 = upperFirst('Id');
  expect(res2).toBe('Id');
  const res3 = upperFirst('idSomething');
  expect(res3).toBe('IdSomething');
});

it('lowerFirst', () => {
  const res1 = lowerFirst('id');
  expect(res1).toBe('id');
  const res2 = lowerFirst('Id');
  expect(res2).toBe('id');
  const res3 = lowerFirst('IdSomething');
  expect(res3).toBe('idSomething');
});
