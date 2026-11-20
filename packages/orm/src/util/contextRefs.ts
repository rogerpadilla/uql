import type { ContextKeyRef, ContextRefs } from '../type/index.js';
import { isPlainObject, soleEntry } from './object.util.js';

/**
 * The context's keys as a policy reads them, each `{ $context: key }`, typed by `UqlContext`:
 * `{ must: { tenantId: $context.tenantId } }`. A leaf module, so the root entry does not reach the metadata through it.
 */
export const $context = new Proxy(
  {},
  { get: (_, key) => (typeof key === 'string' ? { $context: key } : undefined) },
) as ContextRefs;

/** Whether `value` reads a context key, `{ $context: 'tenantId' }`, and nothing else. */
export function isContextRef(value: unknown): value is ContextKeyRef {
  return isPlainObject(value) && typeof value['$context'] === 'string' && soleEntry(value) !== undefined;
}
