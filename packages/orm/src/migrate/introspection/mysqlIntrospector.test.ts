import { expect } from 'vitest';
import { MySql2QuerierPool } from '../../mysql/mysql2QuerierPool.js';
import { createSpec, mysqlConnection } from '../../test/index.js';
import { MySqlFamilyIntrospectorIt } from './mysqlFamilyIntrospector-test.js';
import { MysqlSchemaIntrospector } from './mysqlIntrospector.js';

class MysqlIntrospectorIt extends MySqlFamilyIntrospectorIt {
  constructor() {
    const pool = new MySql2QuerierPool(mysqlConnection());
    super(pool, new MysqlSchemaIntrospector(pool));
  }

  protected readonly otherDatabase = 'test_mysql';

  protected introspectorOf(database: string) {
    return new MysqlSchemaIntrospector(this.pool, database);
  }

  /** A functional key part has no column name, so its place is kept and it reads as an expression. */
  async shouldReadAFunctionalKeyPartAsAnExpression() {
    const schema = await this.probe('probe_functional', async (querier, table) => {
      await querier.run(`CREATE TABLE ${table} (word VARCHAR(9), KEY probe_lower_idx (word, (lower(word))))`);
    });

    expect(schema.indexes).toEqual([
      { name: 'probe_lower_idx', unique: false, entries: [{ column: 'word' }, { column: '', expression: true }] },
    ]);
  }
}

createSpec(new MysqlIntrospectorIt());
