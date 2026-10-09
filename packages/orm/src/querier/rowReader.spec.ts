import { describe, expect, it } from 'vitest';
import type { SelectTerm } from '../dialect/abstractSqlDialect.js';
import type { RawRow } from '../type/index.js';
import { rowReader } from './rowReader.js';

/** Terms as a projection writes them, by key alone: the SQL is not what reading looks at. */
const terms = (...keys: (string | Omit<SelectTerm, 'sql'>)[]): SelectTerm[] =>
  keys.map((key) => (typeof key === 'string' ? { sql: '', key } : { sql: '', ...key }));

const read = (projection: readonly SelectTerm[], row: RawRow) => rowReader<RawRow>(projection)(row);

describe('rowReader', () => {
  it('should leave a flat row as the driver handed it', () => {
    const row = { id: 1, user_id: 2, USER_ROLE: 'admin' };

    expect(read(terms('id', 'user_id', 'USER_ROLE'), row)).toBe(row);
  });

  it('should nest dotted columns, deeply, keeping their nulls', () => {
    const row = { id: '1', name: null, 'item.id': '10', 'item.category.name': 'Tools', 'item.tax.id': null };

    expect(read(terms('id', 'name', 'item.id', 'item.category.name', 'item.tax.id'), row)).toEqual({
      id: '1',
      name: null,
      item: { id: '10', category: { name: 'Tools' }, tax: { id: null } },
    });
  });

  it('should take a row its engine nested already as it is, as SQL Server nests a related row', () => {
    const row = { id: 1, item: { id: 10 } };

    expect(read(terms('id', 'item.id'), row)).toBe(row);
  });

  it('should drop a joined row whose key is null, which is a join that matched nothing', () => {
    const projection = terms('id', { key: 'creator.id', joinedKey: true }, 'creator.name');

    expect(read(projection, { id: 1, 'creator.id': null, 'creator.name': null })).toEqual({ id: 1 });
    expect(read(projection, { id: 1, 'creator.id': 5, 'creator.name': 'Roshi' })).toEqual({
      id: 1,
      creator: { id: 5, name: 'Roshi' },
    });
  });

  it("should read a to-many's rows by their own terms, from JSON text or an array alike", () => {
    const projection = terms('id', { key: 'children', rows: terms({ key: 'payload', kind: 'json' }) });

    expect(read(projection, { id: 1, children: '[{"payload":"{\\"a\\":1}"}]' })).toEqual({
      id: 1,
      children: [{ payload: { a: 1 } }],
    });
    expect(read(projection, { id: 1, children: [{ payload: '{"a":2}' }] })).toEqual({
      id: 1,
      children: [{ payload: { a: 2 } }],
    });
  });

  it('should decode a value by its path, under a joined row and a tally alike', () => {
    const projection = terms({ key: 'company.active', kind: 'boolean' }, { key: '_count.users', kind: 'number' });

    expect(read(projection, { 'company.active': 1, '_count.users': '3' })).toEqual({
      company: { active: true },
      _count: { users: 3 },
    });
  });

  it("should decode a `*`'s fields by key, the columns it reads not being named", () => {
    const projection: SelectTerm[] = [{ sql: '*', bare: true, kinds: [['active', 'boolean']] }];

    expect(read(projection, { id: 1, active: 0 })).toEqual({ id: 1, active: false });
  });

  it('should leave a null alone rather than decode it', () => {
    expect(read(terms({ key: 'active', kind: 'boolean' }), { active: null })).toEqual({ active: null });
  });
});
