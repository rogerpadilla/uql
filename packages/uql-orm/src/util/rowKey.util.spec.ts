import { describe, expect, it } from 'vitest';
import { rowKey } from './rowKey.util.js';

describe('rowKey', () => {
  it('keys a single column by its value', () => {
    expect(rowKey({ id: 1 }, ['id'])).toBe('1');
  });

  it('keys every column, so rows agreeing on one column of a composite differ', () => {
    const columns = ['a', 'b'];
    expect(rowKey({ a: 1, b: 2 }, columns)).not.toBe(rowKey({ a: 1, b: 3 }, columns));
  });

  /** `1` + `2~` and `12` + `~` would collide under a separator a value can carry. */
  it('does not collide across a separator a value could contain', () => {
    const columns = ['a', 'b'];
    expect(rowKey({ a: '1', b: '2,3' }, columns)).not.toBe(rowKey({ a: '1,2', b: '3' }, columns));
  });

  /** `String(date)` is locale- and timezone-dependent, so two equal dates could key apart. */
  it('keys equal dates the same', () => {
    expect(rowKey({ at: new Date('2026-01-01T00:00:00Z') }, ['at'])).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keys bytes by their hex, which commas in a stringified array would blur', () => {
    expect(rowKey({ b: new Uint8Array([1, 2, 255]) }, ['b'])).toBe('0102ff');
    expect(rowKey({ b: new Uint8Array([1, 2]) }, ['b'])).not.toBe(rowKey({ b: new Uint8Array([1, 2, 0]) }, ['b']));
  });

  it('keys no columns as the empty string', () => {
    expect(rowKey({}, [])).toBe('');
  });

  it('reads a column the row does not carry as undefined rather than throwing', () => {
    expect(rowKey({}, ['missing'])).toBe('undefined');
  });
});
