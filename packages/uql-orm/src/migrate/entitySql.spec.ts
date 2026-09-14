import { describe, expect, it } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { defineEntity, Entity, Field, Id, Index } from '../entity/index.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { Type } from '../type/index.js';
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
