import { DEFAULT_MIGRATIONS_TABLE, LOCK_RECORD, type MigrationStorage } from '../migrate/storage/databaseStorage.js';
import type { MongoQuerier } from './mongoQuerier.js';

/** Keyed by the migration's name, so recording one twice is refused the way a SQL primary key refuses it. */
type MigrationDocument = { _id: string; executed_at: Date };

/**
 * Stores migration state in a MongoDB collection, named as the SQL table would be, which MongoDB creates
 * on its first insert.
 */
export class MongoMigrationStorage implements MigrationStorage {
  private readonly collectionName: string;

  constructor(options: { tableName?: string } = {}) {
    this.collectionName = options.tableName ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /** The names recorded, the lock's left out. */
  async executed(querier: MongoQuerier): Promise<string[]> {
    const documents = await this.collection(querier)
      .find({ _id: { $ne: LOCK_RECORD } }, { sort: { _id: 1 } })
      .toArray();
    return documents.map((document) => document._id);
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
