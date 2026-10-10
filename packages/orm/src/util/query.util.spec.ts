import { describe, expect, it } from 'vitest';
import { Entity, Field, getMeta, Id } from '../entity/index.js';
import { User } from '../test/entityMock.js';
import { idKey } from '../type/index.js';
import { assertWhere, whereIds, whereKeysIn } from './query.util.js';
import { sql } from './sql.js';

@Entity()
class Enrolled {
  [idKey]?: 'studentId' | 'courseId';
  @Id({ type: Number }) studentId?: number;
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string | null;
}

describe('whereIds', () => {
  it('should name the one key column for a bare value, and an `IN` for a list of them', () => {
    expect(whereIds(getMeta(User), '1')).toEqual({ id: '1' });
    expect(whereIds(getMeta(User), ['1', '2'])).toEqual({ id: ['1', '2'] });
    expect(whereIds(getMeta(User), [])).toEqual({ id: [] });
  });

  it('should name a composite row by its key map, which is a `$where` already, and a list of them by an OR', () => {
    const id = { studentId: 1, courseId: 'maths' };
    expect(whereIds(getMeta(Enrolled), id)).toBe(id);
    expect(whereIds(getMeta(Enrolled), [id])).toEqual({ $or: [id] });
  });

  /** A scalar names one column, which on a composite would address every row agreeing on it. */
  it('should refuse a bare value where the key is composite', () => {
    expect(() => whereIds(getMeta(Enrolled), 1)).toThrow(
      /composite primary key \(studentId, courseId\), which addressing by a bare id value does not support/,
    );
    expect(() => whereIds(getMeta(Enrolled), [1, 2])).toThrow(/addressing by a bare id value/);
  });
});

describe('assertWhere', () => {
  it('should pass a map, with or without a prototype', () => {
    expect(() => assertWhere(getMeta(User), { id: '1' })).not.toThrow();
    expect(() => assertWhere(getMeta(User), Object.assign(Object.create(null), { id: '1' }))).not.toThrow();
  });

  /** Untyped JS and parsed JSON can still pass these; read as a map, a scalar has no keys and filters nothing. */
  it.each([
    ['an id', '1'],
    ['a list of ids', [1, 2]],
    ['a bare sql()', sql`a > 1`],
    ['null', null],
  ])('refuses %s', (_, where) => {
    expect(() => assertWhere(getMeta(User), where)).toThrow("$where on 'User' must be a map of conditions");
  });
});

describe('whereKeysIn', () => {
  it('should name rows by one key as a list', () => {
    expect(whereKeysIn<User>(['email'], [{ email: 'a' }, { email: 'b' }])).toEqual({ email: ['a', 'b'] });
  });

  it('should name rows by several keys as an alternative each', () => {
    expect(
      whereKeysIn<User>(
        ['name', 'email'],
        [
          { name: 'a', email: 'x' },
          { name: 'b', email: 'y' },
        ],
      ),
    ).toEqual({
      $or: [
        { name: 'a', email: 'x' },
        { name: 'b', email: 'y' },
      ],
    });
  });
});
