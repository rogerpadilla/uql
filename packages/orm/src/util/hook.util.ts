import { getMeta } from '../entity/index.js';
import type { HookEvent, Querier, Type } from '../type/index.js';
import { UqlUsageError } from './uqlError.js';

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
  payloads: readonly E[],
  ctx: HookContext,
): Promise<void> {
  const meta = getMeta(entity);
  const registrations = meta.hooks?.[event];
  if (!registrations?.length) return;

  // A prototype is typed `any`, so what is read off it is typed here, where it enters.
  const prototype: Record<string, unknown> = entity.prototype;
  for (const payload of payloads) {
    for (const { methodName } of registrations) {
      const method = prototype[methodName];
      if (typeof method !== 'function') {
        throw new UqlUsageError(`'${entity.name}' runs '${methodName}' on ${event}, but has no such method`);
      }
      const result: unknown = method.call(payload, ctx);
      if (result instanceof Promise) await result;
    }
  }
}
