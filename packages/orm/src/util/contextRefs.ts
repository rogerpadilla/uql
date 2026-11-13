import type { ContextRefs } from '../type/index.js';

/**
 * The context's keys as a policy reads them, each `{ $context: key }`, typed by `UqlContext`:
 * `{ must: { tenantId: $context.tenantId } }`. A leaf module, so the root entry does not reach the metadata through it.
 */
export const $context = new Proxy(
  {},
  { get: (_, key) => (typeof key === 'string' ? { $context: key } : undefined) },
) as ContextRefs;
