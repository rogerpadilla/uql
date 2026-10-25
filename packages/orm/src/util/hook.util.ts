import { getMeta } from '../entity/index.js';
import type { HookContext, HookEvent, AbstractType } from '../type/index.js';

/** Runs each hook registered for `event` on each payload, in order, awaiting each: a hook mutates the payload itself. */
export async function runHooks<E extends object>(
  entity: AbstractType<E>,
  event: HookEvent,
  payloads: readonly E[],
  ctx: HookContext,
): Promise<void> {
  const meta = getMeta(entity);
  const registrations = meta.hooks?.[event];
  if (!registrations?.length) return;

  for (const payload of payloads) {
    for (const hook of registrations) {
      await hook.run(payload, ctx);
    }
  }
}
