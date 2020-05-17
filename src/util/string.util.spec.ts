import { formatKebabCase, formatCamelCase } from './string.util';

it('formatKebabCase', () => {
  const res1 = formatKebabCase('SomeWordsAndMore');
  expect(res1).toBe('some-words-and-more');
  const res2 = formatKebabCase('someWordsAndMore');
  expect(res2).toBe('some-words-and-more');
});

it('formatCamelCase', () => {
  const res1 = formatCamelCase('SomeWordsAndMore');
  expect(res1).toBe('someWordsAndMore');
  const res2 = formatCamelCase('someWordsAndMore');
  expect(res2).toBe('someWordsAndMore');
});
