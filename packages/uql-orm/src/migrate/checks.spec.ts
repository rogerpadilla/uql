import { describe, expect, it } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { Entity, Field, Id } from '../entity/index.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { Type } from '../type/index.js';
import { raw } from '../util/index.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity({
  checks: [
    { name: 'wallet_non_negative_ck', expression: raw`"balance" >= 0` },
    { expression: raw`"spent" <= "balance"` },
  ],
})
class Wallet {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number;
  @Field({ type: Number }) spent?: number;
}

@Entity({ name: 'purse', checks: [{ expression: raw`"balance" >= 0` }] })
class RenamedWallet {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number;
}

@Entity()
class NoChecks {
  @Id({ type: Number }) id?: number;
}

const ddl = (dialect: AbstractSqlDialect, entity: Type<unknown>) =>
  new SqlSchemaGenerator(dialect).generateCreateSchema([entity]).join('\n');

describe('check constraints', () => {
  it('emits an authored name verbatim', () => {
    expect(ddl(new PostgresDialect(), Wallet)).toContain('CONSTRAINT "wallet_non_negative_ck" CHECK ("balance" >= 0)');
  });

  it('names an unnamed check from the table and its position', () => {
    expect(ddl(new PostgresDialect(), Wallet)).toContain('CONSTRAINT "Wallet__2_ck" CHECK ("spent" <= "balance")');
  });

  it('derives that name from the table the entity was renamed to, not from the class', () => {
    expect(ddl(new PostgresDialect(), RenamedWallet)).toContain('CONSTRAINT "purse__1_ck"');
  });

  it('emits none for an entity that declares none', () => {
    expect(ddl(new PostgresDialect(), NoChecks)).not.toContain('CHECK');
  });

  it('emits the constraint on MariaDB and SQLite, quoting the name for each', () => {
    expect(ddl(new MariaDialect(), Wallet)).toContain('CONSTRAINT `wallet_non_negative_ck` CHECK ("balance" >= 0)');
    expect(ddl(new SqliteDialect(), Wallet)).toContain('CONSTRAINT `Wallet__2_ck` CHECK ("spent" <= "balance")');
  });
});

describe('check expressions', () => {
  it('refuses one carrying a bound value, which CREATE TABLE cannot hold', () => {
    expect(() => {
      @Entity({ checks: [{ expression: raw`"balance" >= ${0}` }] })
      class Bad {
        @Id({ type: Number }) id?: number;
      }
      return Bad;
    }).toThrow(/a check constraint needs raw\(\) with no interpolation/);
  });
});

@Entity()
class Invoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ['draft', 'paid', 'void'] as const })
  status?: 'draft' | 'paid' | 'void';
  @Field({ type: String }) note?: string;
}

@Entity()
class Priority {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number, enum: [1, 2, 3] as const }) level?: 1 | 2 | 3;
}

@Entity()
class Quoted {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ["it's", 'plain'] as const }) label?: "it's" | 'plain';
}

enum Status {
  Draft = 'draft',
  Paid = 'paid',
}

@Entity()
class TsEnumInvoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: Object.values(Status) }) status?: Status;
}

describe('enum fields', () => {
  it('constrains the column to its values', () => {
    expect(ddl(new PostgresDialect(), Invoice)).toContain(
      `"status" TEXT CHECK ("status" IN ('draft', 'paid', 'void'))`,
    );
  });

  it('leaves a field that declares none unconstrained', () => {
    expect(ddl(new PostgresDialect(), Invoice)).toMatch(/"note" TEXT(?! CHECK)/);
  });

  it('leaves numeric values unquoted, so the comparison is against the column type', () => {
    expect(ddl(new PostgresDialect(), Priority)).toContain(`CHECK ("level" IN (1, 2, 3))`);
  });

  it('escapes a value that would close the literal, the way each dialect does it', () => {
    expect(ddl(new PostgresDialect(), Quoted)).toContain(`IN ('it''s', 'plain')`);
    expect(ddl(new MariaDialect(), Quoted)).toContain(`IN ('it\\'s', 'plain')`);
  });

  it('states a TypeScript string enum by its values, not its member names', () => {
    expect(ddl(new PostgresDialect(), TsEnumInvoice)).toContain(`CHECK ("status" IN ('draft', 'paid'))`);
  });

  it('emits the same constraint on MariaDB and SQLite', () => {
    expect(ddl(new MariaDialect(), Invoice)).toContain(`CHECK (\`status\` IN ('draft', 'paid', 'void'))`);
    expect(ddl(new SqliteDialect(), Invoice)).toContain(`CHECK (\`status\` IN ('draft', 'paid', 'void'))`);
  });
});
