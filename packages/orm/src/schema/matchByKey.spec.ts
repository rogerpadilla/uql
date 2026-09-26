import { describe, expect, it } from 'vitest';
import { pairUnique } from './matchByKey.js';

const sameLength = (a: string, b: string) => a.length === b.length;

describe('pairUnique', () => {
  it('should pair an item with the one counterpart it is the same as', () => {
    expect(pairUnique(['abc'], ['xyz', 'pq'], sameLength)).toEqual({
      created: [],
      dropped: ['pq'],
      matched: [['abc', 'xyz']],
    });
  });

  it('should leave an item with two counterparts unpaired', () => {
    expect(pairUnique(['abc'], ['xyz', 'uvw'], sameLength)).toEqual({
      created: ['abc'],
      dropped: ['xyz', 'uvw'],
      matched: [],
    });
  });

  it('should leave a counterpart two items are the same as unpaired', () => {
    expect(pairUnique(['abc', 'def'], ['xyz'], sameLength)).toEqual({
      created: ['abc', 'def'],
      dropped: ['xyz'],
      matched: [],
    });
  });
});
