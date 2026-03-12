import { expect } from 'vitest';
import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec, TaxCategory } from '../test/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

export class MySql2QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MySql2QuerierPool({
        host: '0.0.0.0',
        port: 3316,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
      'INT AUTO_INCREMENT PRIMARY KEY',
    );
  }

  /**
   * MySQL does not support `RETURNING` so `firstId` is unavailable for upserts
   * with non-auto-increment PKs. Override to only assert `changes`.
   */
  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.changes).toBeGreaterThanOrEqual(1);
    expect(insertResult.created).toBe(true);

    const record2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record2).toMatchObject({ name: 'Some Name C' });

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.changes).toBeGreaterThanOrEqual(1);
    expect(updateResult.created).toBe(false);

    const record3 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record3).toMatchObject({ name: 'Some Name D' });
  }
}

createSpec(new MySql2QuerierIt());
