import { expect } from 'vitest';
import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec, TaxCategory } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MariadbQuerierPool({
        host: '0.0.0.0',
        port: 3326,
        user: 'test',
        password: 'test',
        database: 'test',
        connectionLimit: 5,
        trace: true,
        bigIntAsNumber: true,
      }),
      'INT AUTO_INCREMENT PRIMARY KEY',
    );
  }

  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.firstId).toBeDefined();
    expect(insertResult.created).toBeUndefined();

    const record2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record2).toMatchObject({ name: 'Some Name C' });

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.firstId).toBeDefined();
    expect(updateResult.created).toBeUndefined();

    const record3 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record3).toMatchObject({ name: 'Some Name D' });
  }
}

createSpec(new MariadbQuerierIt());
