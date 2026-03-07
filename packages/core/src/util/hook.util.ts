import { getMeta } from '../entity/decorator/index.js';
import type { HookEvent, Querier, Type } from '../type/index.js';

/**
 * Context passed to lifecycle hooks, providing access to the active querier
 * so hooks can perform DB operations within the same transaction.
 */
export type HookContext = {
  readonly querier: Querier;
};

/**
 * Run all registered hooks for the given event on each payload.
 * Hooks are invoked with `this` bound to the payload via `call`,
 * so mutations go directly to the original object.
 */
export async function runHooks<E extends object>(
  entity: Type<E>,
  event: HookEvent,
  payloads: E[],
  ctx: HookContext,
): Promise<void> {
  const meta = getMeta(entity);
  const registrations = meta.hooks?.[event];
  if (!registrations?.length) return;

  for (const payload of payloads) {
    for (const { methodName } of registrations) {
      const result = entity.prototype[methodName].call(payload, ctx);
      if (result instanceof Promise) await result;
    }
  }
}
