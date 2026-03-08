import { QueryRaw, type QueryRawFn, type Scalar } from '../type/index.js';

/**
 * Create a raw SQL expression that bypasses the ORM's automatic escaping.
 *
 * **⚠️ Security:** This function bypasses SQL parameterization. Never pass
 * unsanitized user input directly as the `value` argument — doing so may
 * introduce SQL injection vulnerabilities. Use parameterized queries
 * (e.g. `$where` operators) for any user-supplied data.
 *
 * This is a purely backend function only intended for developers who knows
 * what they are doing.
 *
 * @param value the raw value or a function that receives dialect context
 * @param alias optional alias for the expression (used in SELECT)
 * @returns a QueryRaw instance
 */
export function raw(value: Scalar | QueryRawFn, alias?: string): QueryRaw {
  return new QueryRaw(value, alias);
}
