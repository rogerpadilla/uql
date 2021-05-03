import { kebabCase, startLowerCase, startUpperCase } from './string.util';

it('kebabCase', () => {
  const res1 = kebabCase('SomeWordsAndMore');
  expect(res1).toBe('some-words-and-more');
  const res2 = kebabCase('someWordsAndMore');
  expect(res2).toBe('some-words-and-more');
});

it('startUpperCase', () => {
  const res1 = startUpperCase('id');
  expect(res1).toBe('Id');
  const res2 = startUpperCase('Id');
  expect(res2).toBe('Id');
  const res3 = startUpperCase('idSomething');
  expect(res3).toBe('IdSomething');
});

it('startLowerCase', () => {
  const res1 = startLowerCase('id');
  expect(res1).toBe('id');
  const res2 = startLowerCase('Id');
  expect(res2).toBe('id');
  const res3 = startLowerCase('IdSomething');
  expect(res3).toBe('idSomething');
});
