import * as fs from 'node:fs/promises';
import type { MigrationStorage, Querier } from '../../type/index.js';

/**
 * Stores migration state in a JSON file.
 * Useful for development or environments without a database.
 */
export class JsonMigrationStorage implements MigrationStorage {
  constructor(private readonly filePath = './migrations/.uql-migrations.json') {}

  /** The names the file records, a missing file read as none run yet; any other read failure is the caller's. */
  async executed(): Promise<string[]> {
    const content = await fs.readFile(this.filePath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return '[]';
      }
      throw error;
    });
    return JSON.parse(content);
  }

  async logWithQuerier(_querier: Querier, migrationName: string): Promise<void> {
    const executed = await this.executed();
    if (!executed.includes(migrationName)) {
      await this.save([...executed, migrationName]);
    }
  }

  async unlogWithQuerier(_querier: Querier, migrationName: string): Promise<void> {
    await this.save((await this.executed()).filter((name) => name !== migrationName));
  }

  private save(names: readonly string[]): Promise<void> {
    return fs.writeFile(this.filePath, JSON.stringify(names, null, 2), 'utf-8');
  }
}
