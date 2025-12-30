import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MigrationStorage, SqlQuerier } from '../../type/index.js';

/**
 * Stores migration state in a JSON file (useful for development/testing)
 */
export class JsonMigrationStorage implements MigrationStorage {
  private readonly filePath: string;
  private cache: string[] | null = null;

  constructor(filePath = './migrations/.uql-migrations.json') {
    this.filePath = filePath;
  }

  async ensureStorage(): Promise<void> {
    try {
      await this.load();
    } catch {
      // File doesn't exist, create it
      await this.save([]);
    }
  }

  async executed(): Promise<string[]> {
    await this.ensureStorage();
    return this.cache ?? [];
  }

  async logWithQuerier(_querier: SqlQuerier, migrationName: string): Promise<void> {
    const executed = await this.executed();
    if (!executed.includes(migrationName)) {
      executed.push(migrationName);
      executed.sort();
      await this.save(executed);
    }
  }

  async unlogWithQuerier(_querier: SqlQuerier, migrationName: string): Promise<void> {
    const executed = await this.executed();
    const index = executed.indexOf(migrationName);
    if (index !== -1) {
      executed.splice(index, 1);
      await this.save(executed);
    }
  }

  private async load(): Promise<void> {
    const content = await readFile(this.filePath, 'utf-8');
    this.cache = JSON.parse(content);
  }

  private async save(migrations: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(migrations, null, 2), 'utf-8');
    this.cache = migrations;
  }
}
