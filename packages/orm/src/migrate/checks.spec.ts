import { describe, expect, it } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { Entity, Field, Id } from '../entity/index.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { assertDefined } from '../test/index.js';
import type { Type } from '../type/index.js';
import { raw } from '../util/index.js';
import { reverseDiff } from './schemaChange.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity({
  checks: [{ name: 'wallet_non_negative_ck', where: raw`"balance" >= 0` }, { where: raw`"spent" <= "balance"` }],
})
class Wallet {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number | null;
  @Field({ type: Number }) spent?: number | null;
}

@Entity({ name: 'purse', checks: [{ where: raw`"balance" >= 0` }] })
class RenamedWallet {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number | null;
}

@Entity()
class NoChecks {
  @Id({ type: Number }) id?: number;
}

const ddl = (dialect: AbstractSqlDialect, entity: Type<object>) =>
  new SqlSchemaGenerator(dialect).generateCreateSchema([entity]).join('\n');

/** The name of every object uql installs that the DDL declares. */
const ownedNames = (sql: string) => sql.match(/_uql_\w+/g);

describe('check constraints', () => {
  it('should install an authored check under its name as a label, hashed by its SQL', () => {
    expect(ddl(new PostgresDialect(), Wallet)).toMatch(
      /CONSTRAINT "_uql_Wallet__wallet_non_negative_ck_[0-9a-f]{6}" CHECK \("balance" >= 0\)/,
    );
  });

  it('should label an unnamed check `ck`, so reordering the checks renames none', () => {
    expect(ddl(new PostgresDialect(), Wallet)).toMatch(
      /CONSTRAINT "_uql_Wallet__ck_[0-9a-f]{6}" CHECK \("spent" <= "balance"\)/,
    );
  });

  it('should name an edited check apart from the one it replaces', () => {
    @Entity({ name: 'purse', checks: [{ where: raw`"balance" >= 1` }] })
    class EditedWallet {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) balance?: number | null;
    }
    expect(ownedNames(ddl(new PostgresDialect(), EditedWallet))).not.toEqual(
      ownedNames(ddl(new PostgresDialect(), RenamedWallet)),
    );
  });

  it('should name a check after the table the entity was renamed to, not after the class', () => {
    expect(ddl(new PostgresDialect(), RenamedWallet)).toMatch(/CONSTRAINT "_uql_purse__ck_[0-9a-f]{6}"/);
  });

  it('should emit none for an entity that declares none', () => {
    expect(ddl(new PostgresDialect(), NoChecks)).not.toContain('CHECK');
  });

  it('should emit the constraint on MariaDB and SQLite, quoting the name for each', () => {
    expect(ddl(new MariaDialect(), Wallet)).toMatch(
      /CONSTRAINT ._uql_Wallet__wallet_non_negative_ck_[0-9a-f]{6}. CHECK/,
    );
    expect(ddl(new SqliteDialect(), Wallet)).toMatch(/CONSTRAINT ._uql_Wallet__ck_[0-9a-f]{6}. CHECK/);
  });
});

describe('check expressions', () => {
  it('should write a value as its literal, which CREATE TABLE carries inline', () => {
    @Entity({ checks: [{ where: raw`"balance" >= ${0}` }] })
    class Floor {
      @Id({ type: Number }) id?: number;
    }
    expect(ddl(new PostgresDialect(), Floor)).toContain('CHECK ("balance" >= 0)');
  });

  it('should refuse a value left bound, which CREATE TABLE has no placeholder for', () => {
    @Entity({ checks: [{ where: raw(({ ctx }) => ctx.append('"balance" >= ').pushValue(0).append('$1')) }] })
    class Bound {
      @Id({ type: Number }) id?: number;
    }
    expect(() => ddl(new PostgresDialect(), Bound)).toThrow(/no placeholder/);
  });
});

@Entity()
class Invoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ['draft', 'paid', 'void'] as const })
  status?: 'draft' | 'paid' | 'void' | null;
  @Field({ type: String }) note?: string | null;
}

@Entity()
class Priority {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number, enum: [1, 2, 3] as const }) level?: 1 | 2 | 3 | null;
}

@Entity()
class Quoted {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ["it's", 'plain'] as const }) label?: "it's" | 'plain' | null;
}

enum Status {
  Draft = 'draft',
  Paid = 'paid',
}

@Entity()
class TsEnumInvoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: Object.values(Status) }) status?: Status | null;
}

describe('enum fields', () => {
  /**
   * A stored computed column is a real column, so its declaration carries the `unique`, `nullable` and
   * `enum` it states after the generated clause.
   */
  it('should keep the constraints a stored computed column declares', () => {
    @Entity({ name: 'Priced' })
    class Priced {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) net?: number | null;
      @Field({ type: Number, computed: raw`net * 2`, stored: true, nullable: false, unique: true }) gross?: number;
    }

    const sql = ddl(new PostgresDialect(), Priced);

    expect(sql).toContain('GENERATED ALWAYS AS (net * 2) STORED');
    expect(sql).toContain('NOT NULL');
    expect(sql).toContain('UNIQUE');
  });

  it('should constrain the column to its values, as a check of the table labelled by the column', () => {
    const sql = ddl(new PostgresDialect(), Invoice);
    expect(sql).toMatch(
      /CONSTRAINT "_uql_Invoice__status_[0-9a-f]{6}" CHECK \("status" IN \('draft', 'paid', 'void'\)\)/,
    );
    expect(sql).toContain('"status" TEXT,');
  });

  it('should leave a field that declares none unconstrained', () => {
    expect(ddl(new PostgresDialect(), Invoice)).not.toContain('_uql_Invoice__note');
  });

  it('should leave numeric values unquoted, so the comparison is against the column type', () => {
    expect(ddl(new PostgresDialect(), Priority)).toContain(`CHECK ("level" IN (1, 2, 3))`);
  });

  it('should escape a value that would close the literal, the way each dialect does it', () => {
    expect(ddl(new PostgresDialect(), Quoted)).toContain(`IN ('it''s', 'plain')`);
    expect(ddl(new MariaDialect(), Quoted)).toContain(`IN ('it\\'s', 'plain')`);
  });

  it('should state a TypeScript string enum by its values, not its member names', () => {
    expect(ddl(new PostgresDialect(), TsEnumInvoice)).toContain(`CHECK ("status" IN ('draft', 'paid'))`);
  });

  it('should emit the same constraint on MariaDB and SQLite', () => {
    expect(ddl(new MariaDialect(), Invoice)).toContain(`CHECK (\`status\` IN ('draft', 'paid', 'void'))`);
    expect(ddl(new SqliteDialect(), Invoice)).toContain(`CHECK (\`status\` IN ('draft', 'paid', 'void'))`);
  });
});

@Entity({ name: 'Bill' })
class NarrowBill {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ['draft', 'paid'] as const }) status?: 'draft' | 'paid' | null;
}

@Entity({ name: 'Bill' })
class WideBill {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ['draft', 'paid', 'void'] as const }) status?: 'draft' | 'paid' | 'void' | null;
}

@Entity({ name: 'Bill' })
class PlainBill {
  @Id({ type: Number }) id?: number;
}

/** `entity`'s table as the database would report it, checks included, had `installed` built it. */
const diffOver = (dialect: AbstractSqlDialect, entity: Type<object>, installed: Type<object>) => {
  const generator = new SqlSchemaGenerator(dialect);
  const table = generator.buildAST([installed]).getTable('Bill');
  table?.checks.push({ name: 'Bill_status_check', expression: `"status" <> ''` });
  return { generator, diff: generator.diffSchema(entity, table) };
};

describe('check changes', () => {
  it('should replace a check whose values changed, and leave one uql did not install', () => {
    const { generator, diff } = diffOver(new PostgresDialect(), WideBill, NarrowBill);
    assertDefined(diff);
    const sql = generator.generateAlterTable(diff);

    expect(sql).toEqual([
      expect.stringMatching(/^ALTER TABLE "Bill" DROP CONSTRAINT "_uql_Bill__status_[0-9a-f]{6}";$/),
      expect.stringMatching(
        /^ALTER TABLE "Bill" ADD CONSTRAINT "_uql_Bill__status_[0-9a-f]{6}" CHECK \("status" IN \('draft', 'paid', 'void'\)\);$/,
      ),
    ]);
  });

  it('should put the replaced check back on the way down', () => {
    const { generator, diff } = diffOver(new PostgresDialect(), WideBill, NarrowBill);
    assertDefined(diff);

    expect(generator.generateAlterTable(reverseDiff(diff)).at(-1)).toMatch(
      /ADD CONSTRAINT "_uql_Bill__status_[0-9a-f]{6}" CHECK \("status" IN \('draft', 'paid'\)\);$/,
    );
  });

  it('should report no change for a check already installed', () => {
    expect(diffOver(new PostgresDialect(), WideBill, WideBill).diff).toBeUndefined();
  });

  it('should add the check of an enum column it adds, after the column', () => {
    const { generator, diff } = diffOver(new PostgresDialect(), WideBill, PlainBill);
    assertDefined(diff);

    expect(generator.generateAlterTable(diff)).toEqual([
      'ALTER TABLE "Bill" ADD COLUMN "status" TEXT;',
      expect.stringMatching(/^ALTER TABLE "Bill" ADD CONSTRAINT "_uql_Bill__status_[0-9a-f]{6}" CHECK/),
    ]);
  });

  it('should drop the check of a column before the column, which MySQL refuses to drop under one', () => {
    const { generator, diff } = diffOver(new MySqlDialect(), PlainBill, WideBill);
    assertDefined(diff);

    expect(generator.generateAlterTable(diff)).toEqual([
      expect.stringMatching(/^ALTER TABLE .Bill. DROP CONSTRAINT ._uql_Bill__status_[0-9a-f]{6}.;$/),
      'ALTER TABLE `Bill` DROP COLUMN `status`;',
    ]);
  });

  it('should rebuild the table where the engine alters no constraint', () => {
    const { diff } = diffOver(new SqliteDialect(), WideBill, NarrowBill);
    expect(diff?.rebuild).toBeDefined();
  });
});
