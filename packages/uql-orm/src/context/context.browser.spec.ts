import { expect, it } from 'vitest';
import * as browserContext from './context.browser.js';
import * as nodeContext from './context.js';

it('exposes the exact same API surface as the node context', () => {
  expect(Object.keys(browserContext).sort()).toEqual(Object.keys(nodeContext).sort());
});

it('shares the UqlSecurityError class with the node context (single identity per bundle)', () => {
  expect(browserContext.UqlSecurityError).toBe(nodeContext.UqlSecurityError);
});

it('withContext scopes and restores the context for sync callbacks (nesting included)', () => {
  expect(browserContext.getContext()).toBeUndefined();
  const result = browserContext.withContext({ tenantId: 1 }, () => {
    expect(browserContext.getContext()).toEqual({ tenantId: 1 });
    browserContext.withContext({ tenantId: 2 }, () => {
      expect(browserContext.getContext()).toEqual({ tenantId: 2 });
    });
    expect(browserContext.getContext()).toEqual({ tenantId: 1 });
    return 'done';
  });
  expect(result).toBe('done');
  expect(browserContext.getContext()).toBeUndefined();
});

it('restores the context even when the callback throws', () => {
  expect(() =>
    browserContext.withContext({ tenantId: 1 }, () => {
      throw new Error('boom');
    }),
  ).toThrow('boom');
  expect(browserContext.getContext()).toBeUndefined();
});
