import { AsyncLocalStorage } from 'node:async_hooks';
import type { Querier } from '../type/index.js';

/**
 * The querier `@Transactional()` opened for the current async flow.
 *
 * Separate from the `UqlContext` storage in `context/context.ts` on purpose: that one is remapped to a
 * synchronous browser shim which cannot propagate across `await`, and a querier handle must. Nothing in
 * a browser bundle opens a transaction, so this stays server-only and `verify-dist` keeps it out of the
 * browser-facing graph.
 */
const querierStorage = new AsyncLocalStorage<Querier>();

/** Runs `callback` with `querier` as the ambient one, for the whole async flow beneath it. */
export function withQuerierContext<T>(querier: Querier, callback: () => T): T {
  return querierStorage.run(querier, callback);
}

/**
 * The querier of the enclosing `@Transactional()` method.
 *
 * This is what replaced `@InjectQuerier()`: the standard decorator spec has no parameter decorators, so
 * the querier can no longer be injected into an argument and is read from the ambient flow instead.
 *
 * @example
 * ```ts
 * class UserService {
 *   @Transactional()
 *   async register(data: Partial<User>) {
 *     await currentQuerier().insertOne(User, data);
 *   }
 * }
 * ```
 */
export function currentQuerier(): Querier {
  const querier = querierStorage.getStore();
  if (!querier) {
    throw new TypeError(
      'currentQuerier() found no active querier. Call it inside a @Transactional() method, or take a querier ' +
        'from the pool yourself with `await using querier = await pool.getQuerier()`.',
    );
  }
  return querier;
}

/** The ambient querier, or `undefined` outside a transaction. For callers that can work without one. */
export function currentQuerierIfAny(): Querier | undefined {
  return querierStorage.getStore();
}
