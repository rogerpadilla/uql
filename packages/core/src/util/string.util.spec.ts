import { kebabCase, lowerFirst, snakeCase, upperFirst } from './string.util.js';

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

it('snakeCase', () => {
  const res1 = snakeCase('SomeWordsAndMore');
  expect(res1).toBe('some_words_and_more');
  const res2 = snakeCase('someWordsAndMore');
  expect(res2).toBe('some_words_and_more');
  const res3 = snakeCase('simple');
  expect(res3).toBe('simple');
  const res4 = snakeCase('ID');
  expect(res4).toBe('i_d');
  const res5 = snakeCase('already_snake');
  expect(res5).toBe('already_snake');
  const res6 = snakeCase('');
  expect(res6).toBe('');
  const res7 = snakeCase(undefined);
  expect(res7).toBe(undefined);
  const res8 = snakeCase(null);
  expect(res8).toBe(null);
});
