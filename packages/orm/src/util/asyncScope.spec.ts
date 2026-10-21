import { afterEach, expect, it, vi } from 'vitest';
import { asyncScope } from './asyncScope.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** The scope a runtime without `node:async_hooks` builds, as a browser does. */
async function browserScope<T>() {
  vi.stubGlobal('process', undefined);
  vi.resetModules();
  const { asyncScope: scopeWithoutStorage } = await import('./asyncScope.js');
  return scopeWithoutStorage<T>();
}

it('should carry a value across an await where the runtime has `AsyncLocalStorage`', async () => {
  const scope = asyncScope<number>();

  const seen = await scope.run(1, async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return scope.get();
  });

  expect(seen).toBe(1);
});

it('should hold a value for synchronous callbacks only where the runtime has none', async () => {
  const scope = await browserScope<number>();

  const seen = await scope.run(1, async () => {
    const before = scope.get();
    await Promise.resolve();
    return [before, scope.get()];
  });

  expect(seen).toEqual([1, undefined]);
});

it('should restore the outer value after a nested callback, and after one that throws', async () => {
  const scope = await browserScope<number>();

  const nested = scope.run(1, () => [scope.run(2, () => scope.get()), scope.get()]);
  expect(() =>
    scope.run(3, () => {
      throw new TypeError('boom');
    }),
  ).toThrow('boom');

  expect(nested).toEqual([2, 1]);
  expect(scope.get()).toBeUndefined();
});
