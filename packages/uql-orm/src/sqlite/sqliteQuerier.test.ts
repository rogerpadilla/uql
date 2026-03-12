import { expect } from 'vitest';
import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec, TaxCategory } from '../test/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

export class Sqlite3QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'), 'INTEGER PRIMARY KEY');
  }

  override async beforeEach() {
    await super.beforeEach();
    await Promise.all([
      this.querier.run('PRAGMA foreign_keys = ON'),
      this.querier.run('PRAGMA journal_mode = WAL'),
      this.querier.run('PRAGMA synchronous = normal'),
      this.querier.run('PRAGMA temp_store = memory'),
    ]);
  }

  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.firstId).toBeDefined();
    expect(insertResult.created).toBeUndefined();

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.firstId).toBeDefined();
    expect(updateResult.created).toBeUndefined();

    const record = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record).toMatchObject({ name: 'Some Name D' });
  }
}

createSpec(new Sqlite3QuerierIt());
