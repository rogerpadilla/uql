import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToMany } from '../entity/index.js';
import { MySqlLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec, mysqlConnection, provisioningTimeout } from '../test/index.js';
import { dropTables } from '../test/sqlPools.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierIt extends MySqlLikeQuerierIt {
  constructor() {
    super(new MySql2QuerierPool(mysqlConnection()));
  }
}

createSpec(new MySql2QuerierIt());

/** Keyed by its column's own default, for which a MySQL insert reports no id. */
@Entity({ name: 'uql_linked_label' })
class LinkedLabel {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) name?: string | null;
}

@Entity({ name: 'uql_label_link' })
class LabelLink {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => LabelPost }) labelPostId?: number | null;
  @Field({ references: () => LinkedLabel }) linkedLabelId?: string | null;
}

@Entity({ name: 'uql_label_post' })
class LabelPost {
  @Id({ type: Number }) id?: number;
  @ManyToMany({ entity: () => LinkedLabel, through: () => LabelLink, cascade: true }) labels?: LinkedLabel[];
}

describe('a many-to-many on rows the database keys', () => {
  const pool = new MySql2QuerierPool(mysqlConnection());
  const tables = {
    uql_label_post: '`id` INT AUTO_INCREMENT PRIMARY KEY',
    uql_linked_label: '`id` VARCHAR(36) PRIMARY KEY DEFAULT (UUID()), `name` VARCHAR(20)',
    uql_label_link: '`id` INT AUTO_INCREMENT PRIMARY KEY, `labelPostId` INT, `linkedLabelId` VARCHAR(36)',
  };

  // Dependents first: the shared suite's forced sync created these with their foreign keys.
  const dependentsFirst = Object.keys(tables).reverse();

  beforeAll(async () => {
    await dropTables(pool, ...dependentsFirst);
    for (const [table, columns] of Object.entries(tables)) {
      await pool.run(`CREATE TABLE \`${table}\` (${columns})`);
    }
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, ...dependentsFirst);
    await pool.end();
  }, provisioningTimeout);

  /** A link needs the target's id, which a row the database keyed reports none of on MySQL. */
  it('should refuse to link rows whose ids the insert could not report', async () => {
    await expect(pool.insertOne(LabelPost, { labels: [{ name: 'x' }] })).rejects.toThrow(
      "'LinkedLabel' rows saved through 'LabelLink' reported no id, so they cannot be linked",
    );
    expect(await pool.count(LabelLink, {})).toBe(0);
  });
});
