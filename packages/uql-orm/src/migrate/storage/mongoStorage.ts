import type { MigrationStorage, MongoQuerier, QuerierPool } from '../../type/index.js';
import { withMongoQuerierForMigrations } from '../acquireQuerierForMigrations.js';
import { DEFAULT_MIGRATIONS_TABLE } from './databaseStorage.js';

/** Keyed by the migration's name, so recording one twice is refused the way a SQL primary key refuses it. */
type MigrationDocument = { _id: string; executed_at: Date };

/**
 * Stores migration state in a MongoDB collection, named as the SQL table would be.
 */
export class MongoMigrationStorage implements MigrationStorage {
  private readonly collectionName: string;

  constructor(
    private readonly pool: QuerierPool,
    options: {
      tableName?: string;
    } = {},
  ) {
    this.collectionName = options.tableName ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /** Nothing to prepare: MongoDB creates the collection on its first insert. */
  async ensureStorage(): Promise<void> {}

  executed(): Promise<string[]> {
    return withMongoQuerierForMigrations(this.pool, 'MongoMigrationStorage', async (querier) => {
      const documents = await this.collection(querier)
        .find({}, { sort: { _id: 1 } })
        .toArray();
      return documents.map((document) => document._id);
    });
  }

  async logWithQuerier(querier: MongoQuerier, migrationName: string): Promise<void> {
    await this.collection(querier).insertOne({ _id: migrationName, executed_at: new Date() });
  }

  async unlogWithQuerier(querier: MongoQuerier, migrationName: string): Promise<void> {
    await this.collection(querier).deleteOne({ _id: migrationName });
  }

  private collection(querier: MongoQuerier) {
    return querier.db.collection<MigrationDocument>(this.collectionName);
  }
}
