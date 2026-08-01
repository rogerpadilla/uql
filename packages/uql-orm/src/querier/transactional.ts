import { getQuerierPool } from '../options.js';
import type { IsolationLevel, Querier, QuerierPool } from '../type/index.js';
import { currentQuerierIfAny, withQuerierContext } from './querierContext.js';

export type TransactionalOptions = {
  /** `required` opens a transaction when none is active; `supported` joins one but never starts one. */
  readonly propagation?: 'supported' | 'required';
  readonly pool?: QuerierPool;
  readonly isolationLevel?: IsolationLevel;
};

/**
 * Wraps the method in a transaction and publishes its querier for {@link currentQuerier} to pick up.
 *
 * @remarks Replaces the `@InjectQuerier()` parameter that used to receive the querier. The standard
 * decorator spec has no parameter decorators, and the separate TC39 proposal for them is still Stage 1,
 * so the querier travels through async-local storage instead. A nested call joins the transaction
 * already in flight rather than opening a second one.
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
export function Transactional({ propagation = 'required', pool, isolationLevel }: TransactionalOptions = {}) {
  return <This, Args extends unknown[], R>(
    original: (this: This, ...args: Args) => Promise<R>,
    context: ClassMethodDecoratorContext<This>,
  ) => {
    // Checked at decoration time rather than on the first call: a synchronous method cannot be wrapped in
    // a transaction, and finding that out at startup beats finding out mid-request.
    if (original.constructor.name !== 'AsyncFunction') {
      throw new TypeError(`@Transactional() needs an async method, but '${String(context.name)}' is not one.`);
    }

    return async function (this: This, ...args: Args): Promise<R> {
      // Already inside a transactional flow: join it and let the outermost call own commit and release.
      if (currentQuerierIfAny()) {
        return original.apply(this, args);
      }

      const querier: Querier = await (pool ?? getQuerierPool()).getQuerier();
      try {
        return await withQuerierContext(querier, async () => {
          if (propagation === 'required' && !querier.hasOpenTransaction) {
            await querier.beginTransaction(isolationLevel ? { isolationLevel } : undefined);
          }
          const result = await original.apply(this, args);
          if (querier.hasOpenTransaction) {
            await querier.commitTransaction();
          }
          return result;
        });
      } catch (err) {
        if (querier.hasOpenTransaction) {
          await querier.rollbackTransaction();
        }
        throw err;
      } finally {
        await querier.release();
      }
    };
  };
}
