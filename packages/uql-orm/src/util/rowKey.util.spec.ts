import { describe, expect, it } from 'vitest';
import { rowKey } from './rowKey.util.js';

describe('rowKey', () => {
  it('keys a single value by itself', () => {
    expect(rowKey([1])).toBe('1');
  });

  it('keys every part, so rows agreeing on one column of a composite differ', () => {
    expect(rowKey([1, 2])).not.toBe(rowKey([1, 3]));
  });

  /** `1` + `2~` and `12` + `~` would collide under a separator a value can carry. */
  it('does not collide across a separator a value could contain', () => {
    expect(rowKey(['1', '2,3'])).not.toBe(rowKey(['1,2', '3']));
  });

  /** `String(date)` is locale- and timezone-dependent, so two equal dates could key apart. */
  it('keys equal dates the same', () => {
    expect(rowKey([new Date('2026-01-01T00:00:00Z')])).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keys bytes by their hex, which commas in a stringified array would blur', () => {
    expect(rowKey([new Uint8Array([1, 2, 255])])).toBe('0102ff');
    expect(rowKey([new Uint8Array([1, 2])])).not.toBe(rowKey([new Uint8Array([1, 2, 0])]));
  });

  it('keys nothing as the empty string', () => {
    expect(rowKey([])).toBe('');
  });
});
