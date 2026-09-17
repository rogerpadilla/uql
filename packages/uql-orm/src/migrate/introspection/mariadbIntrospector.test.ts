import { expect } from 'vitest';
import { MariadbQuerierPool } from '../../maria/mariadbQuerierPool.js';
import { createSpec, mariadbConnection } from '../../test/index.js';
import { MySqlFamilyIntrospectorIt } from './mysqlFamilyIntrospector-test.js';
import { MariadbSchemaIntrospector } from './mysqlIntrospector.js';

class MariadbIntrospectorIt extends MySqlFamilyIntrospectorIt {
  constructor() {
    const pool = new MariadbQuerierPool(mariadbConnection());
    super(pool, new MariadbSchemaIntrospector(pool));
  }

  protected readonly otherDatabase = 'test_maria';

  protected introspectorOf(database: string) {
    return new MariadbSchemaIntrospector(this.pool, database);
  }

  /** MariaDB prints a nullable column's default as `NULL`, stated or not, where MySQL prints none. */
  async shouldReadANullableColumnsDefaultAsNull() {
    const schema = await this.probe('probe_null_default', (querier, table) =>
      querier.run(`CREATE TABLE ${table} (stated INT DEFAULT NULL, implied INT)`),
    );

    expect(schema.columns.map(({ name, defaultValue }) => ({ name, defaultValue }))).toEqual([
      { name: 'stated', defaultValue: null },
      { name: 'implied', defaultValue: null },
    ]);
  }
}

createSpec(new MariadbIntrospectorIt());
