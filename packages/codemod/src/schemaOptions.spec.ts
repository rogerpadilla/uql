import { describe, expect, it } from 'vitest';
import { CHAINED_OPTIONS, FIRST_CALL_OPTIONS, KEPT_OPTIONS } from './schemaOptions.js';

describe('schemaOptions', () => {
  it('should chain every section a class-form definer folds in', () => {
    expect(CHAINED_OPTIONS).toEqual(expect.arrayContaining([...KEPT_OPTIONS]));
  });

  it('should keep the name, table, schema, extends and fields on the first call', () => {
    expect(FIRST_CALL_OPTIONS).toEqual(expect.arrayContaining(['name', 'table', 'schema', 'extends', 'fields']));
  });
});
