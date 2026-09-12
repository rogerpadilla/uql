import { describe, expect, it } from 'vitest';
import {
  type MongoCommand,
  type MongoCommandTarget,
  mongoCommandSource,
  runMongoCommand,
  serializeMongoCommand,
} from './mongoCommand.js';

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

describe('mongoCommandSource', () => {
  it('spells each command as the driver call runMongoCommand makes', () => {
    const commands: MongoCommand[] = [
      { action: 'createCollection', name: 'users' },
      { action: 'dropCollection', name: 'users' },
      { action: 'renameCollection', from: 'users', to: 'members' },
      {
        action: 'createIndex',
        collection: 'users',
        name: 'users__email_idx',
        key: { email: 1 },
        options: { unique: true, name: 'users__email_idx' },
      },
      { action: 'dropIndex', collection: 'users', name: 'users__email_idx' },
    ];

    expect(commands.map((command) => mongoCommandSource(serializeMongoCommand(command), 'db'))).toEqual([
      'db.createCollection("users")',
      'db.collection("users").drop()',
      'db.renameCollection("users", "members")',
      'db.collection("users").createIndex({"email":1}, {"unique":true,"name":"users__email_idx"})',
      'db.collection("users").dropIndex("users__email_idx")',
    ]);
  });

  it('refuses a command it has no spelling for', () => {
    expect(() => mongoCommandSource('{"action":"compact","name":"users"}', 'db')).toThrow(
      'unsupported MongoDB migration command',
    );
  });
});

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
      name: 'users__email_idx',
      key: { email: 1, createdAt: -1 },
      options: { unique: true, name: 'users__email_idx' },
    });

    expect(calls).toEqual([
      ['createIndex', 'users', { email: 1, createdAt: -1 }, { unique: true, name: 'users__email_idx' }],
    ]);
  });

  it('should drop an index by name', async () => {
    expect(await run({ action: 'dropIndex', collection: 'users', name: 'users__email_idx' })).toEqual([
      ['dropIndex', 'users', 'users__email_idx'],
    ]);
  });

  it('should refuse a statement it has no command for, rather than skip it', () => {
    const { db } = target();

    expect(() => runMongoCommand(db, '{}')).toThrow('unsupported MongoDB migration command: {}');
  });
});
