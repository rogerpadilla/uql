import type { StandardSchemaV1 } from '../type/index.js';

/** A Standard Schema for a JSON column's definition, which a test checks rather than its payload: uql never runs `validate`. */
export function unvalidatedSchema<O>(): StandardSchemaV1<unknown, O> {
  return { '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [{ message: 'not validated' }] }) } };
}
