import { expect, it } from 'vitest';
import type { QueryWhere } from '../type/index.js';
import { raw } from '../util/raw.js';
import { likePattern, likeLiteral, likeRegex, namesRows } from './operators.js';

class Row {
  id?: number;
  at?: Date | null;
}

// What a WHERE renders from: an `undefined` value, an empty operator map and a group none of whose
// clauses names a row all render nothing, and a write rendering nothing addresses the whole table.
it.each<{ where: QueryWhere<Row> | undefined; names: boolean }>([
  { where: undefined, names: false },
  { where: {}, names: false },
  { where: { id: undefined }, names: false },
  { where: { id: {} }, names: false },
  { where: { $and: [] }, names: false },
  { where: { $or: [{ id: undefined }] }, names: false },
  { where: { $not: [{}] }, names: false },
  { where: { $and: [{}, { $or: [] }] }, names: false },
  { where: { id: null }, names: true },
  { where: { id: 0 }, names: true },
  { where: { at: new Date(0) }, names: true },
  { where: { id: { $in: [] } }, names: true },
  { where: { $or: [{ id: 1 }, {}] }, names: true },
  { where: { $and: [raw`1 = 1`] }, names: true },
])('should read $where as naming rows: $names', ({ where, names }) => {
  expect(namesRows(where)).toBe(names);
});

it.each([
  { value: 'plain', pattern: 'plain' },
  { value: '50%_off', pattern: String.raw`50\%\_off` },
  { value: String.raw`a\b`, pattern: String.raw`a\\b` },
  { value: '[x]', pattern: String.raw`\[x]` },
])('should escape $value as a literal $like pattern', ({ value, pattern }) => {
  expect(likeLiteral(value)).toBe(pattern);
});

it.each([
  { pattern: 'abc', regex: String.raw`^abc\z` },
  { pattern: '%', regex: '' },
  { pattern: 'a%', regex: '^a' },
  { pattern: '%a', regex: String.raw`a\z` },
  { pattern: 'a_c', regex: String.raw`^a[\s\S]c\z` },
  { pattern: String.raw`a\%`, regex: String.raw`^a%\z` },
  { pattern: String.raw`a\\`, regex: String.raw`^a\\\z` },
  { pattern: 'a.(b)', regex: String.raw`^a\.\(b\)\z` },
])('should read the $like pattern $pattern as $regex', ({ pattern, regex }) => {
  expect(likeRegex(pattern)).toBe(regex);
});

it.each(['a\\', 'a\\\\\\'])(
  'should refuse the $like pattern %s, whose last escape has nothing to escape',
  (pattern) => {
    expect(() => likePattern(pattern)).toThrow(
      "a $like pattern cannot end in a '\\' with nothing after it to escape: write '\\\\' to match a backslash",
    );
  },
);

it.each(['a', String.raw`a\\`, String.raw`a\%`])('should pass the $like pattern %s as written', (pattern) => {
  expect(likePattern(pattern)).toBe(pattern);
});

it("should escape a $like pattern's own [, keeping an escaped one", () => {
  expect(likePattern(String.raw`a[b]\[%`)).toBe(String.raw`a\[b]\[%`);
});
