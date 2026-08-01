import { expect, it } from 'vitest';
import type { Querier } from '../type/index.js';
import * as browserQuerierContext from './querierContext.browser.js';
import * as nodeQuerierContext from './querierContext.js';

const querier = {} as Querier;

it('exposes the exact same API surface as the node querier context', () => {
  // The `browser` map swaps one file for the other, so a missing export would only surface as a runtime
  // failure inside a consumer's bundle.
  expect(Object.keys(browserQuerierContext).sort()).toEqual(Object.keys(nodeQuerierContext).sort());
});

it('runs the callback without tracking a querier', () => {
  const result = browserQuerierContext.withQuerierContext(querier, () => 'ran');

  expect(result).toBe('ran');
  expect(browserQuerierContext.currentQuerierIfAny()).toBeUndefined();
});

it('explains that transactions are server-only rather than returning nothing', () => {
  expect(() => browserQuerierContext.currentQuerier()).toThrow(/server-only/);
});
