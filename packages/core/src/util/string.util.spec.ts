import { kebabCase, startCase } from './string.util';

it('kebabCase', () => {
  const res1 = kebabCase('SomeWordsAndMore');
  expect(res1).toBe('some-words-and-more');
  const res2 = kebabCase('someWordsAndMore');
  expect(res2).toBe('some-words-and-more');
});

it('startCase', () => {
  const res1 = startCase('id');
  expect(res1).toBe('Id');
  const res2 = startCase('Id');
  expect(res2).toBe('Id');
});
