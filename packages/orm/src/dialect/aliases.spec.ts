import { describe, expect, it } from 'vitest';
import { nullsSortField } from './aliases.js';

describe('nullsSortField', () => {
  it('should name a flag field with no dot in it, which MongoDB would read as a path', () => {
    expect(nullsSortField('kind.public')).not.toContain('.');
  });

  it('should keep two paths apart that differ only in a dot and an underscore', () => {
    expect(nullsSortField('kind.public')).not.toBe(nullsSortField('kind_public'));
    expect(nullsSortField('a_.b')).not.toBe(nullsSortField('a._b'));
  });
});
