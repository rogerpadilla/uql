import { describe, expect, it } from 'vitest';
import { type MongoCommand, type MongoCommandTarget, runMongoCommand, serializeMongoCommand } from './mongoCommand.js';

type Call = readonly [string, ...unknown[]];

function target(): { calls: Call[]; db: MongoCommandTarget } {
  const calls: Call[] = [];
  const record = (name: string, ...args: unknown[]): Promise<unknown> => {
    calls.push([name, ...args]);
    return Promise.resolve();
  };
  return {
    calls,
    db: {
      createCollection: (name) => record('createCollection', name),
      renameCollection: (from, to) => record('renameCollection', from, to),
      collection: (name) => ({
        drop: () => record('drop', name),
        createIndex: (key, options) => record('createIndex', name, key, options),
        dropIndex: (indexName) => record('dropIndex', name, indexName),
      }),
    },
  };
}

async function run(command: MongoCommand): Promise<Call[]> {
  const { calls, db } = target();
  await runMongoCommand(db, serializeMongoCommand(command));
  return calls;
}

describe('runMongoCommand', () => {
  it('should create a collection', async () => {
    expect(await run({ action: 'createCollection', name: 'users' })).toEqual([['createCollection', 'users']]);
  });

  it('should drop a collection', async () => {
    expect(await run({ action: 'dropCollection', name: 'users' })).toEqual([['drop', 'users']]);
  });

  it('should rename a collection', async () => {
    expect(await run({ action: 'renameCollection', from: 'users', to: 'people' })).toEqual([
      ['renameCollection', 'users', 'people'],
    ]);
  });

  it('should create an index with its key spec and options', async () => {
    const calls = await run({
      action: 'createIndex',
      collection: 'users',
      name: 'idx_users_email',
      key: { email: 1, createdAt: -1 },
      options: { unique: true, name: 'idx_users_email' },
    });

    expect(calls).toEqual([
      ['createIndex', 'users', { email: 1, createdAt: -1 }, { unique: true, name: 'idx_users_email' }],
    ]);
  });

  it('should drop an index by name', async () => {
    expect(await run({ action: 'dropIndex', collection: 'users', name: 'idx_users_email' })).toEqual([
      ['dropIndex', 'users', 'idx_users_email'],
    ]);
  });

  it('should refuse a statement it has no command for, rather than skip it', () => {
    const { db } = target();

    expect(() => runMongoCommand(db, '{}')).toThrow('unsupported MongoDB migration command: {}');
  });
});
