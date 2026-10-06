import { expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Item } from '../test/index.js';
import { hasRequiredJoin } from './queryJoins.js';

/** Only a `$required` join changes how many parents a read returns; any other only widens them. */
it('should tell a read dropping the parents a join has no match for', () => {
  const meta = getMeta(Item);

  expect(hasRequiredJoin(meta, { $populate: { tax: true, measureUnit: true } })).toBe(false);
  expect(hasRequiredJoin(meta, { $populate: { tax: true, measureUnit: { $required: true } } })).toBe(true);
});
