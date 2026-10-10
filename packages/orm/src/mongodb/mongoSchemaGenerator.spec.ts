import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { added, reverseDiff } from '../migrate/schemaChange.js';
import { createTableNode } from '../schema/schemaAST.js';
import type { TableNode } from '../schema/types.js';
import { assertDefined } from '../test/index.js';
import type { EntityWhere, Type } from '../type/index.js';
import { sql } from '../util/index.js';
import { validatorCheck } from './mongoCommand.js';
import { MongoSchemaGenerator } from './mongoSchemaGenerator.js';

@Entity()
class MongoUser {
  @Id({ type: String }) id?: string;
  @Field({ type: String, index: true }) username?: string | null;
  @Field({ type: String, index: 'email_idx', unique: true }) email?: string | null;
}

@Index((ticket) => [ticket.status, { column: ticket.createdAt, order: 'desc' }], { unique: true })
@Index((ticket) => [ticket.assignee], {
  name: 'urgent_assignee_idx',
  where: { priority: { $gte: 2 }, $or: [{ status: 'open' }, { status: 'held' }] },
})
@Entity()
class MongoTicket {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) status?: string | null;
  @Field({ type: String }) assignee?: string | null;
  @Field({ type: Number }) priority?: number | null;
  @Field({ type: Date }) createdAt?: Date | null;
}

/** The vector first, then each field a `$vectorSearch` pre-filters on. */
@Index((chunk) => [chunk.embedding, chunk.tenant], { type: 'vectorSearch', distance: 'l2' })
@Entity()
class MongoChunk {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) tenant?: string | null;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[] | null;
}

const urgentAssigneeOptions = {
  name: 'urgent_assignee_idx',
  unique: false,
  partialFilterExpression: { priority: { $gte: 2 }, $or: [{ status: 'open' }, { status: 'held' }] },
};

const statusCreatedAtOptions = { name: 'MongoTicket__status_createdAt_idx', unique: true };

type TicketShape = { id?: string; status?: string | null; createdAt?: Date | null; views?: bigint | null };

const ticketIndexedWhere = (where: EntityWhere<TicketShape>): Type<object> => {
  @Index((ticket) => [ticket.status], { name: 'ticket_idx', where })
  @Entity()
  class Ticket implements TicketShape {
    @Id({ type: String }) id?: string;
    @Field({ type: String }) status?: string | null;
    @Field({ type: Date }) createdAt?: Date | null;
    @Field({ type: BigInt }) views?: bigint | null;
  }
  return Ticket;
};

describe('MongoSchemaGenerator', () => {
  const generator = new MongoSchemaGenerator();

  it('should drop one collection per entity', () => {
    expect(generator.generateDropSchema([MongoUser]).map((json) => JSON.parse(json))).toEqual([
      { action: 'dropCollection', name: 'MongoUser' },
    ]);
  });

  it('should alter nothing, either way, where no index is missing', () => {
    const diff = { tableName: 'MongoUser', type: 'alter' as const };
    expect(generator.generateAlterTable(diff)).toEqual([]);
    expect(generator.generateAlterTable(reverseDiff(diff))).toEqual([]);
  });

  /**
   * A collection plus one `createIndex` per index, as the SQL generator emits `CREATE TABLE` and then
   * each `CREATE INDEX`; the key spec carries a descending or a text entry as declared.
   */
  it('should generate createCollection followed by a createIndex per index', () => {
    const statements = generator.generateCreateSchema([MongoUser]).map((json) => JSON.parse(json));

    expect(statements[0]).toMatchObject({ action: 'createCollection', name: 'MongoUser' });
    expect(statements.slice(1)).toEqual([
      {
        action: 'createIndex',
        collection: 'MongoUser',
        name: 'MongoUser__username_idx',
        key: { username: 1 },
        options: { name: 'MongoUser__username_idx', unique: false },
      },
      {
        action: 'createIndex',
        collection: 'MongoUser',
        name: 'email_idx',
        key: { email: 1 },
        options: { name: 'email_idx', unique: true },
      },
    ]);
  });

  /** MongoDB enforces uniqueness only through an index, so a unique field is one whether or not it names it. */
  it('should build a unique field as a unique index, with no index option of its own', () => {
    @Entity()
    class MongoHandle {
      @Id({ type: String }) id?: string;
      @Field({ type: String, unique: true }) handle?: string | null;
    }

    expect(
      generator
        .generateCreateSchema([MongoHandle])
        .map((json) => JSON.parse(json))
        .slice(1),
    ).toEqual([
      {
        action: 'createIndex',
        collection: 'MongoHandle',
        name: 'MongoHandle__handle_idx',
        key: { handle: 1 },
        options: { name: 'MongoHandle__handle_idx', unique: true },
      },
    ]);
  });

  it('should map a descending entry to -1 and a fulltext index to a text key', () => {
    const descending = JSON.parse(
      generator.generateCreateIndex('MongoUser', {
        name: 'recent_idx',
        entries: [{ column: 'createdAt', order: 'desc' }],
        unique: false,
      }),
    );
    const text = JSON.parse(
      generator.generateCreateIndex('MongoUser', {
        name: 'text_idx',
        entries: [{ column: 'username' }, { column: 'email' }],
        unique: false,
        type: 'fulltext',
      }),
    );

    expect(descending.key).toEqual({ createdAt: -1 });
    expect(text.key).toEqual({ username: 'text', email: 'text' });
  });

  /** MongoDB weighs a text index's fields itself, so the weights are the index's own option. */
  it('should weigh a fulltext index by its columns, and leave an unweighted one without', () => {
    const create = (entries: readonly { column: string; weight?: number }[]) =>
      JSON.parse(
        generator.generateCreateIndex('MongoUser', { name: 'text_idx', entries, unique: false, type: 'fulltext' }),
      );

    expect(create([{ column: 'username', weight: 10 }, { column: 'email' }]).options.weights).toEqual({
      username: 10,
      email: 1,
    });
    expect(create([{ column: 'username' }, { column: 'email' }]).options.weights).toBeUndefined();
  });

  /**
   * A fulltext index's `config` is MongoDB's `default_language`, `'simple'` being its `'none'`: no stemming,
   * which is also what one stating none builds with, as on SQL.
   */
  it('should build a text index in the language its config names', () => {
    const create = (config?: string) =>
      JSON.parse(
        generator.generateCreateIndex('MongoUser', {
          name: 'text_idx',
          entries: [{ column: 'username' }],
          unique: false,
          type: 'fulltext',
          config,
        }),
      );

    expect(create('spanish').options.default_language).toBe('spanish');
    expect(create('simple').options.default_language).toBe('none');
    expect(create().options.default_language).toBe('none');
  });

  it('should build the text index an entity declares in the language it names', () => {
    @Index((article) => [article.body], { type: 'fulltext', config: 'spanish' })
    @Entity()
    class MongoArticle {
      @Id({ type: String }) id?: string;
      @Field({ type: String }) body?: string | null;
    }

    const [, index] = generator.generateCreateSchema([MongoArticle]).map((json) => JSON.parse(json));

    expect(index.options.default_language).toBe('spanish');
  });

  describe('Atlas vector search index', () => {
    const chunkIndex = {
      action: 'createSearchIndex',
      collection: 'MongoChunk',
      index: {
        name: 'embedding_index',
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'embedding', numDimensions: 3, similarity: 'euclidean' },
            { type: 'filter', path: 'tenant' },
          ],
        },
      },
    };

    /** Named as the `$vectorSearch` stage reads it by default, so an unnamed index is the one queried. */
    it('should create it with the collection, named after its vector field', () => {
      expect(generator.generateCreateSchema([MongoChunk]).map((json) => JSON.parse(json))).toEqual([
        { action: 'createCollection', name: 'MongoChunk' },
        chunkIndex,
      ]);
    });

    it('should drop it as a search index when the migration is undone', () => {
      const diff = generator.diffSchema(MongoChunk, createTableNode('MongoChunk'));
      assertDefined(diff);

      expect(generator.generateAlterTable(reverseDiff(diff)).map((json) => JSON.parse(json))).toEqual([
        { action: 'dropSearchIndex', collection: 'MongoChunk', name: 'embedding_index' },
      ]);
    });

    it('should refuse one whose vector field states no dimensions', () => {
      expect(() =>
        generator.generateCreateIndex('MongoChunk', {
          name: 'embedding_index',
          entries: [{ column: 'embedding' }],
          unique: false,
          type: 'vectorSearch',
        }),
      ).toThrow('an Atlas vector search index states its field\'s dimensions (index "embedding_index")');
    });

    it('should refuse a metric Atlas has no similarity for', () => {
      expect(() =>
        generator.generateCreateIndex('MongoChunk', {
          name: 'embedding_index',
          entries: [{ column: 'embedding' }],
          unique: false,
          type: 'vectorSearch',
          dimensions: 3,
          distance: 'l1',
        }),
      ).toThrow('mongodb does not support vector distance metric: l1 (index "embedding_index")');
    });
  });

  it('should reject index options MongoDB has no equivalent for', () => {
    expect(() =>
      generator.generateCreateIndex('MongoUser', {
        name: 'expr_idx',
        entries: [{ column: 'lower(username)', expression: true }],
        unique: false,
      }),
    ).toThrow('mongodb does not support expression indexes (index "expr_idx")');

    expect(() =>
      generator.generateCreateIndex('MongoUser', {
        name: 'path_idx',
        entries: [{ column: 'profile', jsonPath: { path: 'theme', type: 'text' } }],
        unique: false,
      }),
    ).toThrow('mongodb does not support indexes over a path inside a JSON column (index "path_idx")');

    expect(() =>
      generator.generateCreateIndex('MongoUser', {
        name: 'covering_idx',
        entries: [{ column: 'username' }],
        unique: false,
        include: ['email'],
      }),
    ).toThrow('mongodb does not support covering indexes (INCLUDE) (index "covering_idx")');

    expect(() =>
      generator.generateCreateIndex('MongoUser', {
        name: 'hash_idx',
        entries: [{ column: 'username' }],
        unique: false,
        type: 'hash',
      }),
    ).toThrow('mongodb has no hash index (index "hash_idx")');
  });

  it('should create the indexes @Index declares, a partial one with its filter', () => {
    const statements = generator.generateCreateSchema([MongoTicket]).map((json) => JSON.parse(json));

    expect(statements.slice(1)).toEqual([
      {
        action: 'createIndex',
        collection: 'MongoTicket',
        name: 'urgent_assignee_idx',
        key: { assignee: 1 },
        options: urgentAssigneeOptions,
      },
      {
        action: 'createIndex',
        collection: 'MongoTicket',
        name: 'MongoTicket__status_createdAt_idx',
        key: { status: 1, createdAt: -1 },
        options: statusCreatedAtOptions,
      },
    ]);
  });

  it('should add each @Index a collection lacks, its filter included', () => {
    const diff = generator.diffSchema(MongoTicket, collectionWith('MongoTicket'));
    assertDefined(diff);
    const statements = generator.generateAlterTable(diff).map((json) => JSON.parse(json));

    expect(statements.map((statement) => statement.options)).toEqual([urgentAssigneeOptions, statusCreatedAtOptions]);
  });

  const refused: [string, EntityWhere<TicketShape>][] = [
    ['$ne', { status: { $ne: 'closed' } }],
    ['$nin', { status: { $nin: ['closed'] } }],
    ['$not', { $not: [{ status: 'closed' }] }],
    ['$startsWith', { status: { $startsWith: 'op' } }],
    ['$isNull', { createdAt: { $isNull: true } }],
    ['null', { createdAt: null }],
    ['a Date', { createdAt: { $gt: new Date(0) } }],
    ['a bigint', { views: { $gt: 1n } }],
    ['an ObjectId', { id: '507f1f77bcf86cd799439011' }],
  ];

  it.each(refused)('should refuse %s in a partial index, which MongoDB has no room for', (part, where) => {
    expect(() => generator.generateCreateSchema([ticketIndexedWhere(where)])).toThrow(
      `mongodb does not support ${part} in a partial index predicate (index "ticket_idx")`,
    );
  });

  it('should refuse SQL as a partial index predicate', () => {
    const where: EntityWhere<TicketShape> = (ticket) => sql`${ticket.status} = 'open'`;
    expect(() => generator.generateCreateSchema([ticketIndexedWhere(where)])).toThrow(
      'mongodb does not support partial indexes from a SQL predicate (index "ticket_idx")',
    );
  });

  it('should generate createIndex statement', () => {
    const cmd = JSON.parse(
      generator.generateCreateIndex('MongoUser', { name: 'test_idx', entries: [{ column: 'test' }], unique: true }),
    );

    expect(cmd).toEqual({
      action: 'createIndex',
      collection: 'MongoUser',
      name: 'test_idx',
      key: { test: 1 },
      options: { unique: true, name: 'test_idx' },
    });
  });

  it('should generate dropIndex statement', () => {
    const [command] = generator.generateOperation({ type: 'dropIndex', tableName: 'MongoUser', indexName: 'test_idx' });
    expect(JSON.parse(command)).toEqual({
      action: 'dropIndex',
      collection: 'MongoUser',
      name: 'test_idx',
    });
  });

  it('should plan a create where the collection does not exist', () => {
    const diff = generator.diffSchema(MongoUser, undefined);
    expect(diff).toMatchObject({
      tableName: 'MongoUser',
      type: 'create',
    });
  });

  it('should plan an alter where indexes are missing', () => {
    const diff = generator.diffSchema(
      MongoUser,
      collectionWith('MongoUser', { name: 'MongoUser__username_idx', unique: false }),
    );

    expect(diff).toMatchObject({ tableName: 'MongoUser', type: 'alter' });
    expect(added(diff?.indexes).map((index) => index.name)).toEqual(['email_idx']);
  });

  it('should plan nothing where the collection is in sync', () => {
    const current = collectionWith(
      'MongoUser',
      { name: 'MongoUser__username_idx', unique: false },
      { name: 'email_idx', unique: true },
    );

    expect(generator.diffSchema(MongoUser, current)).toBeUndefined();
  });

  /** No engine alters an index, so one that changed is dropped and created anew, and back on the way down. */
  it('should rebuild an index that changed, and restore it on the way down', () => {
    const current = collectionWith(
      'MongoUser',
      { name: 'MongoUser__username_idx', unique: false },
      { name: 'email_idx', unique: false },
    );
    const diff = generator.diffSchema(MongoUser, current);
    assertDefined(diff);
    const commands = (statements: string[]) =>
      statements.map((statement) => {
        const { action, name, options } = JSON.parse(statement);
        return [action, name, options?.unique];
      });

    expect(commands(generator.generateAlterTable(diff))).toEqual([
      ['dropIndex', 'email_idx', undefined],
      ['createIndex', 'email_idx', true],
    ]);
    expect(commands(generator.generateAlterTable(reverseDiff(diff)))).toEqual([
      ['dropIndex', 'email_idx', undefined],
      ['createIndex', 'email_idx', false],
    ]);
  });

  /** A plan is data a caller logs or stores, so an index it drops points back at no table. */
  it('should plan a diff that serializes as JSON', () => {
    const current = collectionWith(
      'MongoUser',
      { name: 'MongoUser__username_idx', unique: false },
      { name: 'email_idx', unique: false },
    );
    const diff = generator.diffSchema(MongoUser, current);

    expect(JSON.parse(JSON.stringify(diff))).toEqual(diff);
  });
});

describe('MongoSchemaGenerator validator', () => {
  const generator = new MongoSchemaGenerator();

  @Entity({ checks: [{ where: { priority: { $gte: 0 } } }, { name: 'capped', where: { priority: { $lte: 9 } } }] })
  class MongoTask {
    @Id({ type: String }) id?: string;
    @Field({ type: String, enum: ['open', 'closed'] as const }) status?: 'open' | 'closed' | null;
    @Field({ type: Number }) priority?: number | null;
  }

  const taskValidator = {
    $and: [{ priority: { $gte: 0 } }, { priority: { $lte: 9 } }, { status: { $in: ['open', 'closed', null] } }],
  };

  @Entity()
  class MongoLabel {
    @Id({ type: String }) id?: string;
    @Field({ type: Number, enum: [1, 2] as const }) tier?: 1 | 2 | null;
  }

  type TaskShape = { id?: string; dueAt?: Date | null; status?: string | null };

  const taskChecking = (where: EntityWhere<TaskShape>): Type<object> => {
    @Entity({ name: 'Task', checks: [{ where }] })
    class Task implements TaskShape {
      @Id({ type: String }) id?: string;
      @Field({ type: Date }) dueAt?: Date | null;
      @Field({ type: String }) status?: string | null;
    }
    return Task;
  };

  const commands = (statements: readonly string[]) => statements.map((json) => JSON.parse(json));

  /** A missing or null value passes an enum, as SQL's `CHECK` passes NULL. */
  it('should create the collection with a validator of its checks, then each enum', () => {
    expect(commands(generator.generateCreateSchema([MongoTask]))).toEqual([
      { action: 'createCollection', name: 'MongoTask', validator: taskValidator },
    ]);
  });

  it('should take a lone clause as the validator itself', () => {
    expect(commands(generator.generateCreateSchema([MongoLabel]))).toEqual([
      { action: 'createCollection', name: 'MongoLabel', validator: { tier: { $in: [1, 2, null] } } },
    ]);
  });

  it('should refuse a check given as SQL', () => {
    expect(() => generator.generateCreateSchema([taskChecking((task) => sql`${task.status} <> 'x'`)])).toThrow(
      'mongodb does not support checks from a SQL predicate (collection "Task")',
    );
  });

  it('should refuse a value a migration cannot carry as JSON', () => {
    expect(() => generator.generateCreateSchema([taskChecking({ dueAt: { $gt: new Date(0) } })])).toThrow(
      'mongodb does not support a Date in a check (collection "Task")',
    );
  });

  it('should keep a null a check compares with, which a validator holds', () => {
    expect(commands(generator.generateCreateSchema([taskChecking({ status: { $ne: null } })]))).toEqual([
      { action: 'createCollection', name: 'Task', validator: { status: { $ne: null } } },
    ]);
  });

  it('should set the validator a collection lacks with collMod, and remove it on the way down', () => {
    const diff = generator.diffSchema(MongoTask, createTableNode('MongoTask'));
    assertDefined(diff);

    expect(commands(generator.generateAlterTable(diff))).toEqual([
      { action: 'collMod', name: 'MongoTask', validator: taskValidator },
    ]);
    expect(commands(generator.generateAlterTable(reverseDiff(diff)))).toEqual([
      { action: 'collMod', name: 'MongoTask', validator: {} },
    ]);
  });

  it('should replace a changed validator, and restore it on the way down', () => {
    const stale = { tier: { $in: [1, null] } };
    const diff = generator.diffSchema(MongoLabel, withValidator(createTableNode('MongoLabel'), stale));
    assertDefined(diff);

    expect(commands(generator.generateAlterTable(diff))).toEqual([
      { action: 'collMod', name: 'MongoLabel', validator: { tier: { $in: [1, 2, null] } } },
    ]);
    expect(commands(generator.generateAlterTable(reverseDiff(diff)))).toEqual([
      { action: 'collMod', name: 'MongoLabel', validator: stale },
    ]);
  });

  it('should remove a validator the entity no longer declares', () => {
    const current = collectionWith(
      'MongoUser',
      { name: 'MongoUser__username_idx', unique: false },
      { name: 'email_idx', unique: true },
    );
    const diff = generator.diffSchema(MongoUser, withValidator(current, { email: { $exists: true } }));
    assertDefined(diff);

    expect(commands(generator.generateAlterTable(diff))).toEqual([
      { action: 'collMod', name: 'MongoUser', validator: {} },
    ]);
  });

  it('should plan nothing where the validator is in sync', () => {
    expect(
      generator.diffSchema(MongoLabel, withValidator(createTableNode('MongoLabel'), { tier: { $in: [1, 2, null] } })),
    ).toBeUndefined();
  });
});

/** `table` holding `validator`, as the introspector reads one back. */
function withValidator(table: TableNode, validator: Record<string, unknown>): TableNode {
  table.checks.push(validatorCheck(table.name, validator));
  return table;
}

/**
 * A collection as the database holds it: each index over the one field it is named after, `<field>_idx`
 * or `<Collection>__<field>_idx`.
 */
function collectionWith(name: string, ...indexes: { name: string; unique: boolean }[]): TableNode {
  const table = createTableNode(name);
  const field = (index: string) => index.replace(/^.*__/, '').replace(/_idx$/, '');
  table.indexes.push(...indexes.map((index) => ({ ...index, table, entries: [{ column: field(index.name) }] })));
  return table;
}
