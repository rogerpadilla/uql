import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { Computed, defineEntity, Entity, f, Field } from '../entity/index.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { EntityWhereMeta, Json, AbstractType } from '../type/index.js';
import { memberRefs, sql } from '../util/index.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity({
  checks: (ledger, check) => [check({ balance: { $gte: 0 } }), check(sql`${ledger.spent} >= ${ledger.refunded}`)],
})
class Ledger {
  @Field(f.number().id()) id?: number;
  @Field(f.number().nullable()) balance?: number | null;
  @Field(f.number().nullable()) spent?: number | null;
  @Field(f.number().nullable()) refunded?: number | null;
}

@Entity({
  indexes: (account, index) => [
    index([sql`lower(${account.emailAddress})`], { where: sql`${account.deletedAt} IS NULL` }),
    index([account.emailAddress], { unique: true, where: { deletedAt: null } }),
  ],
})
class Account {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) emailAddress?: string | null;
  @Field(f.date().nullable().softDelete()) deletedAt?: Date | null;
}

@Entity()
class Scored {
  @Field(f.number().id()) id?: number;
  @Field(f.number().nullable()) rawScore?: number | null;
  @Computed((scored) =>
    f
      .number()
      .nullable()
      .as(sql`${scored.rawScore} + 1`)
      .stored(),
  )
  nextScore?: number | null;
}

const Line = defineEntity({
  name: 'Line',
  fields: { id: f.number().id(), unitPrice: f.number().nullable(), qty: f.number().nullable() },
}).computed((line) => ({
  total: f
    .number()
    .nullable()
    .as(sql`${line.unitPrice} * ${line.qty}`)
    .stored(),
}));

const ddl = (dialect: AbstractSqlDialect, entity: AbstractType<object>) =>
  new SqlSchemaGenerator(dialect).generateCreateSchema([entity]).join('\n');

describe('SQL an entity declares', () => {
  it('should compile a check to the predicate it states, quoting each column the way its engine does', () => {
    expect(ddl(new PostgresDialect(), Ledger)).toContain('CHECK ("balance" >= 0)');
    expect(ddl(new PostgresDialect(), Ledger)).toContain('CHECK ("spent" >= "refunded")');
    expect(ddl(new MariaDialect(), Ledger)).toContain('CHECK (`balance` >= 0)');
    expect(ddl(new SqliteDialect(), Ledger)).toContain('CHECK (`spent` >= `refunded`)');
  });

  it("should compile a partial index's predicate without the entity's own filters", () => {
    expect(ddl(new PostgresDialect(), Account)).toContain('("emailAddress") WHERE "deletedAt" IS NULL;');
  });

  it('should render an index expression and its predicate from the fields they read', () => {
    expect(ddl(new PostgresDialect(), Account)).toContain('((lower("emailAddress"))) WHERE "deletedAt" IS NULL;');
  });

  it('should resolve every reference through the naming strategy, from a decorator and from a schema alike', () => {
    const snake = new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
    expect(ddl(snake, Account)).toContain('((lower("email_address"))) WHERE "deleted_at" IS NULL;');
    expect(ddl(snake, Scored)).toContain('GENERATED ALWAYS AS ("raw_score" + 1) STORED');
    expect(ddl(snake, Line)).toContain('GENERATED ALWAYS AS ("unit_price" * "qty") STORED');
  });

  it('should refuse a partial index on an engine that has none', () => {
    expect(() => ddl(new MySqlDialect(), Account)).toThrow(/partial/);
  });

  it('should write the vector a predicate compares against as its literal, like any other value', () => {
    @Entity({ checks: (near, check) => [check({ embedding: { $near: { $vector: [1, 2, 3], $lt: 0.5 } } })] })
    class Near {
      @Field(f.number().id()) id?: number;
      @Field(f.vector(3).nullable()) embedding?: number[] | null;
    }
    expect(ddl(new PostgresDialect(), Near)).toContain(`CHECK ("embedding" <=> '[1,2,3]'::vector < 0.5)`);
  });

  it('should refuse a predicate given no entity to read it against', () => {
    // @ts-expect-error: not a `sql` statement
    expect(() => new PostgresDialect().compileDdl({ id: 1 })).toThrow('a predicate compiles against the entity');
  });
});

describe('a date SQL an entity declares compares against', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should be written in UTC, so the DDL does not depend on the machine generating it', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const epoch = new Date(0);
    @Entity({ checks: (dated, check) => [check({ closedAt: { $gte: epoch } }), check({ closedAt: { $in: [epoch] } })] })
    class Dated {
      @Field(f.number().id()) id?: number;
      @Field(f.date().nullable()) closedAt?: Date | null;
    }
    const pg = ddl(new PostgresDialect(), Dated);
    expect(pg).toContain(`"closedAt" TIMESTAMPTZ`);
    expect(pg).toContain(`CHECK ("closedAt" >= '1970-01-01 00:00:00.000+00')`);
    expect(pg).toContain(`CHECK ("closedAt" IN ('1970-01-01 00:00:00.000+00'))`);
    expect(ddl(new MySqlDialect(), Dated)).toContain("CHECK (`closedAt` >= '1970-01-01 00:00:00.000')");
  });
});

type TicketShape = {
  id?: number;
  status?: string | null;
  priority?: number | null;
  closedAt?: Date | null;
  data?: Json<{ theme?: string }> | null;
};

const ticketIndexedWhere = (where: EntityWhereMeta<TicketShape>): AbstractType<object> => {
  @Entity({ indexes: (ticket, index) => [index([ticket.status], { name: 'ticket_idx', where })] })
  class Ticket implements TicketShape {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) status?: string | null;
    @Field(f.number().nullable()) priority?: number | null;
    @Field(f.date().nullable()) closedAt?: Date | null;
    @Field(f.json().nullable()) data?: Json<{ theme?: string }> | null;
  }
  return Ticket;
};

describe('a SQL Server filtered index', () => {
  const refused: [string, EntityWhereMeta<TicketShape>][] = [
    ['$or', { $or: [{ status: 'open' }, { priority: 1 }] }],
    ['$not', { $not: [{ status: 'open' }] }],
    ['$nin', { status: { $nin: ['closed'] } }],
    ['$between', { priority: { $between: [1, 3] } }],
    ['$startsWith', { status: { $startsWith: 'op' } }],
    ['$or', { $and: [{ priority: 1 }, { $or: [{ status: 'open' }, { status: 'held' }] }] }],
    ['a JSON path', { 'data.theme': 'dark' }],
  ];

  it.each(refused)('should refuse %s, which its filter grammar has no room for', (operator, where) => {
    expect(() => ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toThrow(
      `SQL Server does not support ${operator} in a partial index predicate (index "ticket_idx")`,
    );
  });

  it('should take comparisons, IN and IS NULL, joined by AND', () => {
    const where: EntityWhereMeta<TicketShape> = {
      closedAt: null,
      priority: { $gte: 1, $ne: 3 },
      $and: [{ status: { $in: ['open', 'held'] } }],
    };
    expect(ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toContain(
      `WHERE "closedAt" IS NULL AND ("priority" >= 1 AND "priority" <> 3) AND "status" IN (N'open', N'held');`,
    );
  });

  it('should refuse an $and left undefined, as the query does', () => {
    const where: EntityWhereMeta<TicketShape> = { status: 'open', $and: undefined };
    expect(() => ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toThrow("holds undefined at '$and'");
  });

  it('should leave a raw predicate to the server', () => {
    const where: EntityWhereMeta<TicketShape> = sql`${memberRefs<TicketShape>().closedAt} IS NOT NULL`;
    expect(ddl(new MsSqlDialect(), ticketIndexedWhere(where))).toContain(`WHERE "closedAt" IS NOT NULL;`);
  });
});
