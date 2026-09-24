import { expect, it } from 'vitest';
import type { QueryWhere } from '../type/index.js';
import { raw } from '../util/raw.js';
import { namesRows } from './operators.js';

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
