import { describe, expect, it } from 'vitest';
import { parseVectorLiteral } from './vectorCast.js';

describe('parseVectorLiteral', () => {
  it('reads a dense literal of numbers', () => {
    expect(parseVectorLiteral(' [1,0,2] ', 'vector')).toEqual([1, 0, 2]);
  });

  /** Valid JSON is not enough: a vector holds numbers, so anything else is left as the raw text. */
  it('refuses a dense literal holding anything but numbers', () => {
    expect(parseVectorLiteral('[1,"a"]', 'vector')).toBeUndefined();
  });
});
