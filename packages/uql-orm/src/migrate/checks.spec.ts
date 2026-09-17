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
  checks: [{ name: 'wallet_non_negative_ck', where: raw`"balance" >= 0` }, { where: raw`"spent" <= "balance"` }],
})
class Wallet {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number;
  @Field({ type: Number }) spent?: number;
}

@Entity({ name: 'purse', checks: [{ where: raw`"balance" >= 0` }] })
class RenamedWallet {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) balance?: number;
}

@Entity()
class NoChecks {
  @Id({ type: Number }) id?: number;
}

const ddl = (dialect: AbstractSqlDialect, entity: Type<object>) =>
  new SqlSchemaGenerator(dialect).generateCreateSchema([entity]).join('\n');

describe('check constraints', () => {
  it('should emit an authored name verbatim', () => {
    expect(ddl(new PostgresDialect(), Wallet)).toContain('CONSTRAINT "wallet_non_negative_ck" CHECK ("balance" >= 0)');
  });

  it('should name an unnamed check from the table and its position', () => {
    expect(ddl(new PostgresDialect(), Wallet)).toContain('CONSTRAINT "Wallet__2_ck" CHECK ("spent" <= "balance")');
  });

  it('should derive that name from the table the entity was renamed to, not from the class', () => {
    expect(ddl(new PostgresDialect(), RenamedWallet)).toContain('CONSTRAINT "purse__1_ck"');
  });

  it('should emit none for an entity that declares none', () => {
    expect(ddl(new PostgresDialect(), NoChecks)).not.toContain('CHECK');
  });

  it('should emit the constraint on MariaDB and SQLite, quoting the name for each', () => {
    expect(ddl(new MariaDialect(), Wallet)).toContain('CONSTRAINT `wallet_non_negative_ck` CHECK ("balance" >= 0)');
    expect(ddl(new SqliteDialect(), Wallet)).toContain('CONSTRAINT `Wallet__2_ck` CHECK ("spent" <= "balance")');
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
  /**
   * A stored computed column is a real column, so its declaration carries the `unique`, `nullable` and
   * `enum` it states after the generated clause.
   */
  it('should keep the constraints a stored computed column declares', () => {
    @Entity({ name: 'Priced' })
    class Priced {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) net?: number;
      @Field({ type: Number, computed: raw`net * 2`, stored: true, nullable: false, unique: true }) gross?: number;
    }

    const sql = ddl(new PostgresDialect(), Priced);

    expect(sql).toContain('GENERATED ALWAYS AS (net * 2) STORED');
    expect(sql).toContain('NOT NULL');
    expect(sql).toContain('UNIQUE');
  });

  /**
   * A column added to an existing table carries its check, as a created one does. An alter of an existing
   * column leaves it out: MySQL adds a second check rather than replacing the first.
   */
  it('should constrain an enum column it adds to an existing table', () => {
    const [sql] = new SqlSchemaGenerator(new PostgresDialect()).generateAlterTable({
      type: 'alter',
      tableName: 'Invoice',
      columnsToAdd: [
        {
          name: 'status',
          type: 'VARCHAR(20)',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
          enum: ['draft', 'paid'],
        },
      ],
    });

    expect(sql).toContain(`CHECK ("status" IN ('draft', 'paid'))`);
  });

  it('should constrain the column to its values', () => {
    expect(ddl(new PostgresDialect(), Invoice)).toContain(
      `"status" TEXT CHECK ("status" IN ('draft', 'paid', 'void'))`,
    );
  });

  it('should leave a field that declares none unconstrained', () => {
    expect(ddl(new PostgresDialect(), Invoice)).toMatch(/"note" TEXT(?! CHECK)/);
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

  /** MariaDB takes nothing after a column's `CHECK`, so the enum's comes after its `DEFAULT`. */
  it('should put the CHECK after the default, the one order MariaDB takes', () => {
    const [sql] = new SqlSchemaGenerator(new MariaDialect()).generateAlterTable({
      type: 'alter',
      tableName: 'Invoice',
      columnsToAdd: [
        {
          name: 'status',
          type: 'VARCHAR(20)',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
          defaultValue: 'draft',
          enum: ['draft', 'paid'],
        },
      ],
    });

    expect(sql).toBe(
      "ALTER TABLE `Invoice` ADD COLUMN `status` VARCHAR(20) DEFAULT 'draft' CHECK (`status` IN ('draft', 'paid'));",
    );
  });
});
