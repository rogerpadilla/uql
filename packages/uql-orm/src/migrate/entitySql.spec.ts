import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { defineEntity, Entity, Field, Id, Index } from '../entity/index.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { EntityWhere, Json, Type } from '../type/index.js';
import { raw } from '../util/index.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity({
  checks: [{ where: { balance: { $gte: 0 } } }, { where: (ledger) => raw`${ledger.spent} >= ${ledger.refunded}` }],
})
class Ledger {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number;
  @Field({ type: Number }) spent?: number;
  @Field({ type: Number }) refunded?: number;
}

@Index((account) => [account.emailAddress], { unique: true, where: { deletedAt: null } })
@Index((account) => [raw`lower(${account.emailAddress})`], {
  where: (account) => raw`${account.deletedAt} IS NULL`,
})
@Entity()
class Account {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) emailAddress?: string;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date;
}

@Entity()
class Scored {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) rawScore?: number;
  @Field({ type: Number, computed: (scored) => raw`${scored.rawScore} + 1`, stored: true }) nextScore?: number;
}

class Line {
  id?: number;
  unitPrice?: number;
  qty?: number;
  total?: number;
}

defineEntity(Line, {
  fields: {
    id: { type: Number, isId: true },
    unitPrice: { type: Number },
    qty: { type: Number },
    total: { type: Number, computed: (line) => raw`${line.unitPrice} * ${line.qty}`, stored: true },
  },
});

const ddl = (dialect: AbstractSqlDialect, entity: Type<object>) =>
  new SqlSchemaGenerator(dialect).generateCreateSchema([entity]).join('\n');

describe('SQL an entity declares', () => {
  it('compiles a check to the predicate it states, quoting each column the way its engine does', () => {
    expect(ddl(new PostgresDialect(), Ledger)).toContain('CHECK ("balance" >= 0)');
    expect(ddl(new PostgresDialect(), Ledger)).toContain('CHECK ("spent" >= "refunded")');
    expect(ddl(new MariaDialect(), Ledger)).toContain('CHECK (`balance` >= 0)');
    expect(ddl(new SqliteDialect(), Ledger)).toContain('CHECK (`spent` >= `refunded`)');
  });

  it("compiles a partial index's predicate without the entity's own filters", () => {
    expect(ddl(new PostgresDialect(), Account)).toContain('("emailAddress") WHERE "deletedAt" IS NULL;');
  });

  it('renders an index expression and its predicate from the fields they read', () => {
    expect(ddl(new PostgresDialect(), Account)).toContain('((lower("emailAddress"))) WHERE "deletedAt" IS NULL;');
  });

  it('resolves every reference through the naming strategy, from a decorator and from defineEntity alike', () => {
    const snake = new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
    expect(ddl(snake, Account)).toContain('((lower("email_address"))) WHERE "deleted_at" IS NULL;');
    expect(ddl(snake, Scored)).toContain('GENERATED ALWAYS AS ("raw_score" + 1) STORED');
    expect(ddl(snake, Line)).toContain('GENERATED ALWAYS AS ("unit_price" * "qty") STORED');
  });

  it('refuses a partial index on an engine that has none', () => {
    expect(() => ddl(new MySqlDialect(), Account)).toThrow(/partial/);
  });

  it('writes the vector a predicate compares against as its literal, like any other value', () => {
    @Entity({ checks: [{ where: { embedding: { $near: { $vector: [1, 2, 3], $lt: 0.5 } } } }] })
    class Near {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector', dimensions: 3 }) embedding?: number[];
    }
    expect(ddl(new PostgresDialect(), Near)).toContain(`CHECK ("embedding" <=> '[1,2,3]'::vector < 0.5)`);
  });

  it('refuses a predicate given no entity to read it against', () => {
    expect(() => new PostgresDialect().compileDdl({ id: 1 } as never)).toThrow(
      'a predicate compiles against the entity',
    );
  });
});

describe('a date SQL an entity declares compares against', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is written in UTC, so the DDL does not depend on the machine generating it', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const epoch = new Date(0);
    @Entity({ checks: [{ where: { closedAt: { $gte: epoch } } }, { where: { closedAt: { $in: [epoch] } } }] })
    class Dated {
      @Id({ type: Number }) id?: number;
      @Field({ type: Date }) closedAt?: Date;
    }
    expect(ddl(new PostgresDialect(), Dated)).toContain(`CHECK ("closedAt" >= '1970-01-01 00:00:00.000')`);
    expect(ddl(new PostgresDialect(), Dated)).toContain(`CHECK ("closedAt" IN ('1970-01-01 00:00:00.000'))`);
    expect(ddl(new MySqlDialect(), Dated)).toContain("CHECK (`closedAt` >= '1970-01-01 00:00:00.000')");
  });
});

type TicketShape = {
  id?: number;
  status?: string;
  priority?: number;
  closedAt?: Date;
  data?: Json<{ theme?: string }>;
};

const ticketIndexedWhere = (where: EntityWhere<TicketShape>): Type<object> => {
  @Index((ticket) => [ticket.status], { name: 'ticket_idx', where })
  @Entity()
  class Ticket implements TicketShape {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) status?: string;
    @Field({ type: Number }) priority?: number;
    @Field({ type: Date }) closedAt?: Date;
    @Field({ type: 'json' }) data?: Json<{ theme?: string }>;
  }
  return Ticket;
};

describe('a SQL Server filtered index', () => {
  const refused: [string, EntityWhere<TicketShape>][] = [
    ['$or', { $or: [{ status: 'open' }, { priority: 1 }] }],
    ['$not', { $not: [{ status: 'open' }] }],
    ['$nin', { status: { $nin: ['closed'] } }],
    ['$between', { priority: { $between: [1, 3] } }],
    ['$startsWith', { status: { $startsWith: 'op' } }],
    ['$or', { $and: [{ priority: 1 }, { $or: [{ status: 'open' }, { status: 'held' }] }] }],
    ['a JSON path', { 'data.theme': 'dark' }],
  ];

  it.each(refused)('refuses %s, which its filter grammar has no room for', (operator, where) => {
    expect(() => ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toThrow(
      `mssql does not support ${operator} in a partial index predicate (index "ticket_idx")`,
    );
  });

  it('takes comparisons, IN and IS NULL, joined by AND', () => {
    const where: EntityWhere<TicketShape> = {
      closedAt: null,
      priority: { $gte: 1, $ne: 3 },
      $and: [{ status: { $in: ['open', 'held'] } }],
    };
    expect(ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toContain(
      `WHERE "closedAt" IS NULL AND ("priority" >= 1 AND "priority" <> 3) AND "status" IN (N'open', N'held');`,
    );
  });

  it('leaves a raw predicate to the server', () => {
    const where: EntityWhere<TicketShape> = (ticket) => raw`${ticket.closedAt} IS NOT NULL`;
    expect(ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toContain(`WHERE "closedAt" IS NOT NULL;`);
  });
});
