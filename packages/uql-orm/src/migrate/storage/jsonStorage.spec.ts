import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlQuerier } from '../../type/index.js';
import { JsonMigrationStorage } from './jsonStorage.js';

describe('JsonMigrationStorage', () => {
  const filePath = path.resolve(process.cwd(), 'test-migrations.json');
  const storage = new JsonMigrationStorage(filePath);
  const mockQuerier = {} as SqlQuerier;

  afterEach(async () => {
    try {
      await fs.unlink(filePath);
    } catch {}
  });

  it('ensureStorage should create file if not exists', async () => {
    // File shouldn't exist initially
    await expect(fs.access(filePath)).rejects.toThrow();

    await storage.ensureStorage();

    // File should exist now
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('[]');
  });

  it('executed should return list of migrations', async () => {
    await fs.writeFile(filePath, JSON.stringify(['m1', 'm2']));
    const executed = await storage.executed();
    expect(executed).toEqual(['m1', 'm2']);
  });

  it('logWithQuerier should add migration', async () => {
    await storage.logWithQuerier(mockQuerier, 'm1');
    const executed = await storage.executed();
    expect(executed).toEqual(['m1']);

    await storage.logWithQuerier(mockQuerier, 'm1'); // Duplicate
    expect(await storage.executed()).toEqual(['m1']);
  });

  it('unlogWithQuerier should remove migration', async () => {
    await fs.writeFile(filePath, JSON.stringify(['m1', 'm2']));
    await storage.unlogWithQuerier(mockQuerier, 'm1');
    const executed = await storage.executed();
    expect(executed).toEqual(['m2']);

    await storage.unlogWithQuerier(mockQuerier, 'm3'); // Non-existent
    expect(await storage.executed()).toEqual(['m2']);
  });
});
