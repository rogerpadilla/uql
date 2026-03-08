import * as fs from 'node:fs/promises';
import type { MigrationStorage, SqlQuerier } from '../../type/index.js';

/**
 * Stores migration state in a JSON file.
 * Useful for development or environments without a database.
 */
export class JsonMigrationStorage implements MigrationStorage {
  private executedMigrations: string[] = [];
  private readonly filePath: string;

  constructor(filePath = './migrations/.uql-migrations.json') {
    this.filePath = filePath;
  }

  async ensureStorage(): Promise<void> {
    const content = await fs.readFile(this.filePath, 'utf-8').catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const initial = '[]';
        await fs.writeFile(this.filePath, initial, 'utf-8');
        return initial;
      }
      throw error;
    });
    this.executedMigrations = JSON.parse(content);
  }

  async executed(): Promise<string[]> {
    await this.ensureStorage();
    return this.executedMigrations;
  }

  async logWithQuerier(_querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    if (!this.executedMigrations.includes(migrationName)) {
      this.executedMigrations.push(migrationName);
      await this.save();
    }
  }

  async unlogWithQuerier(_querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    this.executedMigrations = this.executedMigrations.filter((m) => m !== migrationName);
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(this.executedMigrations, null, 2), 'utf-8');
  }
}
