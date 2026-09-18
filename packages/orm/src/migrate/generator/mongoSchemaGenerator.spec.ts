import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../../entity/index.js';
import { createTableNode } from '../../schema/schemaAST.js';
import type { TableNode } from '../../schema/types.js';
import { assertDefined } from '../../test/index.js';
import type { EntityWhere, Type } from '../../type/index.js';
import { raw } from '../../util/index.js';
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

const urgentAssigneeOptions = {
  name: 'urgent_assignee_idx',
  unique: false,
  partialFilterExpression: { priority: { $gte: 2 }, $or: [{ status: 'open' }, { status: 'held' }] },
};

const statusCreatedAtOptions = { name: 'MongoTicket__status_createdAt_idx', unique: true };

type TicketShape = { id?: string; status?: string | null; createdAt?: Date | null };

const ticketIndexedWhere = (where: EntityWhere<TicketShape>): Type<object> => {
  @Index((ticket) => [ticket.status], { name: 'ticket_idx', where })
  @Entity()
  class Ticket implements TicketShape {
    @Id({ type: String }) id?: string;
    @Field({ type: String }) status?: string | null;
    @Field({ type: Date }) createdAt?: Date | null;
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
    expect(generator.generateAlterTableDown(diff)).toEqual([]);
  });

  /**
   * A collection plus one `createIndex` per index, as the SQL generator emits `CREATE TABLE` and then
   * each `CREATE INDEX`; the key spec carries a descending or a text entry as declared.
   */
  it('should generate createCollection followed by a createIndex per index', () => {
    const statements = generator.generateCreateTable(MongoUser).map((json) => JSON.parse(json));

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
    const statements = generator.generateCreateTable(MongoTicket).map((json) => JSON.parse(json));

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
    ['an ObjectId', { id: '507f1f77bcf86cd799439011' }],
  ];

  it.each(refused)('should refuse %s in a partial index, which MongoDB has no room for', (part, where) => {
    expect(() => generator.generateCreateTable(ticketIndexedWhere(where))).toThrow(
      `mongodb does not support ${part} in a partial index predicate (index "ticket_idx")`,
    );
  });

  it('should refuse SQL as a partial index predicate', () => {
    const where: EntityWhere<TicketShape> = (ticket) => raw`${ticket.status} = 'open'`;
    expect(() => generator.generateCreateTable(ticketIndexedWhere(where))).toThrow(
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
    expect(JSON.parse(generator.generateDropIndex('MongoUser', 'test_idx'))).toEqual({
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
    expect(diff?.indexesToAdd?.map((index) => index.name)).toEqual(['email_idx']);
  });

  it('should plan nothing where the collection is in sync', () => {
    const current = collectionWith(
      'MongoUser',
      { name: 'MongoUser__username_idx', unique: false },
      { name: 'email_idx', unique: true },
    );

    expect(generator.diffSchema(MongoUser, current)).toBeUndefined();
  });

  it('should generate alter statements', () => {
    const diff = {
      tableName: 'MongoUser',
      type: 'alter' as const,
      indexesToAdd: [{ name: 'test_idx', entries: [{ column: 'test' }], unique: false }],
    };
    const statements = generator.generateAlterTable(diff);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"action":"createIndex"');
  });

  it('should generate alter down statements', () => {
    const diff = {
      tableName: 'MongoUser',
      type: 'alter' as const,
      indexesToAdd: [{ name: 'test_idx', entries: [{ column: 'test' }], unique: false }],
    };
    const statements = generator.generateAlterTableDown(diff);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"action":"dropIndex"');
  });
});

/** A collection as the database holds it: the indexes named, over no columns it could report. */
function collectionWith(name: string, ...indexes: { name: string; unique: boolean }[]): TableNode {
  const table = createTableNode(name);
  table.indexes.push(...indexes.map((index) => ({ ...index, table, entries: [] })));
  return table;
}
