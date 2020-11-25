import { formatKebabCase } from './string.util';

it('formatKebabCase', () => {
  const res1 = formatKebabCase('SomeWordsAndMore');
  expect(res1).toBe('some-words-and-more');
  const res2 = formatKebabCase('someWordsAndMore');
  expect(res2).toBe('some-words-and-more');
});
