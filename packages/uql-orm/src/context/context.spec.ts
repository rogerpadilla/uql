import { expect, it } from 'vitest';
import { captureContext, getContext, withContext } from './context.js';

it('captureContext replays the captured context on a later, foreign async tick', async () => {
  const scoped = withContext({ tenantId: 7 }, () => captureContext());

  // outside the original scope the ambient context is gone...
  expect(getContext()).toBeUndefined();

  // ...but a callback fired later (e.g. from an emitter/timer tick) sees it via the runner
  const seen = await new Promise((resolve) => {
    setTimeout(() => resolve(scoped(() => getContext())), 0);
  });
  expect(seen).toEqual({ tenantId: 7 });
  expect(getContext()).toBeUndefined();
});

it('captureContext with no active context just invokes the callback', () => {
  const scoped = captureContext();
  expect(scoped(() => getContext())).toBeUndefined();
  expect(scoped(() => 'ran')).toBe('ran');
});
