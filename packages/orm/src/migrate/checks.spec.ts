import { describe, expect, it } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { Computed, Entity, f, Field } from '../entity/index.js';
import { MariaDialect } from '../mariadb/mariaDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { assertDefined } from '../test/index.js';
import type { AbstractType, Json } from '../type/index.js';
import { sql } from '../util/index.js';
import { reverseDiff } from './schemaChange.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity({
  checks: (wallet, check) => [check(sql`"balance" >= 0`, 'wallet_non_negative_ck'), check(sql`"spent" <= "balance"`)],
})
class Wallet {
  @Field(f.number().id()) id?: number;
  @Field(f.number().nullable()) balance?: number | null;
  @Field(f.number().nullable()) spent?: number | null;
}

@Entity({ name: 'purse', checks: (renamedWallet, check) => [check(sql`"balance" >= 0`)] })
class RenamedWallet {
  @Field(f.number().id()) id?: number;
  @Field(f.number().nullable()) balance?: number | null;
}

@Entity()
class NoChecks {
  @Field(f.number().id()) id?: number;
}

const ddl = (dialect: AbstractSqlDialect, entity: AbstractType<object>) =>
  new SqlSchemaGenerator(dialect).generateCreateSchema([entity]).join('\n');

/** The name of every object uql installs that the DDL declares. */
const ownedNames = (statement: string) => statement.match(/_uql_\w+/g);

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
    @Entity({ name: 'purse', checks: (editedWallet, check) => [check(sql`"balance" >= 1`)] })
    class EditedWallet {
      @Field(f.number().id()) id?: number;
      @Field(f.number().nullable()) balance?: number | null;
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
    @Entity({ checks: (floor, check) => [check(sql`"balance" >= ${0}`)] })
    class Floor {
      @Field(f.number().id()) id?: number;
    }
    expect(ddl(new PostgresDialect(), Floor)).toContain('CHECK ("balance" >= 0)');
  });

  it('should compare a column with another through its ref, as a query does', () => {
    @Entity({
      checks: (rate, check) => [
        check({ effectiveTo: { $gt: rate.effectiveFrom } }),
        check({ fromHour: { $gte: 0, $lt: rate.toHour }, toHour: { $lte: 24 } }),
      ],
    })
    class Rate {
      @Field(f.number().id()) id?: number;
      @Field(f.date()) effectiveFrom!: Date;
      @Field(f.date().nullable()) effectiveTo?: Date | null;
      @Field(f.number()) fromHour!: number;
      @Field(f.number()) toHour!: number;
    }
    const statement = ddl(new PostgresDialect(), Rate);
    expect(statement).toContain('CHECK ("effectiveTo" > "effectiveFrom")');
    expect(statement).toContain('CHECK (("fromHour" >= 0 AND "fromHour" < "toHour") AND "toHour" <= 24)');
  });

  it('should read a JSON path compared with a column by that column’s type, as a query does', () => {
    @Entity({ checks: (doc, check) => [check({ 'meta.rank': { $eq: doc.rank } })] })
    class Ranked {
      @Field(f.number().id()) id?: number;
      @Field(f.number().nullable()) rank?: number | null;
      @Field(f.jsonb().nullable()) meta?: Json<{ rank?: number }> | null;
    }
    expect(ddl(new PostgresDialect(), Ranked)).toContain(`::numeric END = "rank")`);
  });

  it('should refuse a value left bound, which CREATE TABLE has no placeholder for', () => {
    @Entity({
      checks: (bound, check) => [check(sql(({ ctx }) => ctx.append('"balance" >= ').pushValue(0).append('$1')))],
    })
    class Bound {
      @Field(f.number().id()) id?: number;
    }
    expect(() => ddl(new PostgresDialect(), Bound)).toThrow(/no placeholder/);
  });
});

@Entity()
class Invoice {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(['draft', 'paid', 'void']).nullable())
  status?: 'draft' | 'paid' | 'void' | null;
  @Field(f.string().nullable()) note?: string | null;
}

@Entity()
class Priority {
  @Field(f.number().id()) id?: number;
  @Field(f.enum([1, 2, 3]).nullable()) level?: 1 | 2 | 3 | null;
}

@Entity()
class Quoted {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(["it's", 'plain']).nullable()) label?: "it's" | 'plain' | null;
}

enum Status {
  Draft = 'draft',
  Paid = 'paid',
}

@Entity()
class TsEnumInvoice {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(Object.values(Status)).nullable()) status?: Status | null;
}

describe('enum fields', () => {
  /**
   * A stored computed column is a real column, so its declaration carries the `unique`, `nullable` and
   * `enum` it states after the generated clause.
   */
  it('should keep the constraints a stored computed column declares', () => {
    @Entity({ name: 'Priced' })
    class Priced {
      @Field(f.number().id()) id?: number;
      @Field(f.number().nullable()) net?: number | null;
      @Computed((row) =>
        f
          .number()
          .unique()
          .as(sql`net * 2`)
          .stored(),
      )
      gross?: number;
    }

    const statement = ddl(new PostgresDialect(), Priced);

    expect(statement).toContain('GENERATED ALWAYS AS (net * 2) STORED');
    expect(statement).toContain('NOT NULL');
    expect(statement).toContain('UNIQUE');
  });

  it('should constrain the column to its values, as a check of the table labelled by the column', () => {
    const statement = ddl(new PostgresDialect(), Invoice);
    expect(statement).toMatch(
      /CONSTRAINT "_uql_Invoice__status_[0-9a-f]{6}" CHECK \("status" IN \('draft', 'paid', 'void'\)\)/,
    );
    expect(statement).toContain('"status" TEXT,');
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

  it('should name and state the check by its values, whatever order they are declared in', () => {
    @Entity({ name: 'Invoice' })
    class Reordered {
      @Field(f.number().id()) id?: number;
      @Field(f.enum(['void', 'draft', 'paid']).nullable()) status?: 'draft' | 'paid' | 'void' | null;
      @Field(f.string().nullable()) note?: string | null;
    }

    expect(ddl(new PostgresDialect(), Reordered)).toBe(ddl(new PostgresDialect(), Invoice));
    expect(ddl(new PostgresDialect(), Reordered)).toContain(`CHECK ("status" IN ('draft', 'paid', 'void'))`);
  });

  it('should order numeric values as numbers', () => {
    @Entity({ name: 'Priority' })
    class Reordered {
      @Field(f.number().id()) id?: number;
      @Field(f.enum([10, 2, 1]).nullable()) level?: 1 | 2 | 10 | null;
    }

    expect(ddl(new PostgresDialect(), Reordered)).toContain(`CHECK ("level" IN (1, 2, 10))`);
  });

  it('should emit the same constraint on MariaDB and SQLite', () => {
    expect(ddl(new MariaDialect(), Invoice)).toContain(`CHECK (\`status\` IN ('draft', 'paid', 'void'))`);
    expect(ddl(new SqliteDialect(), Invoice)).toContain(`CHECK (\`status\` IN ('draft', 'paid', 'void'))`);
  });
});

@Entity({ name: 'Bill' })
class NarrowBill {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(['draft', 'paid']).nullable()) status?: 'draft' | 'paid' | null;
}

@Entity({ name: 'Bill' })
class WideBill {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(['draft', 'paid', 'void']).nullable()) status?: 'draft' | 'paid' | 'void' | null;
}

@Entity({ name: 'Bill' })
class PlainBill {
  @Field(f.number().id()) id?: number;
}

/** `entity`'s table as the database would report it, checks included, had `installed` built it. */
const diffOver = (dialect: AbstractSqlDialect, entity: AbstractType<object>, installed: AbstractType<object>) => {
  const generator = new SqlSchemaGenerator(dialect);
  const table = generator.buildAST([installed]).getTable('Bill');
  table?.checks.push({ name: 'Bill_status_check', expression: `"status" <> ''` });
  return { generator, diff: generator.diffSchema(entity, table) };
};

describe('check changes', () => {
  it('should replace a check whose values changed, and leave one uql did not install', () => {
    const { generator, diff } = diffOver(new PostgresDialect(), WideBill, NarrowBill);
    assertDefined(diff);
    const statement = generator.generateAlterTable(diff);

    expect(statement).toEqual([
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
