import { describe, expect, it } from 'vitest';
import { MsSqlDialect } from '../../mssql/mssqlDialect.js';
import { splitSqlStatements } from '../builder/splitSqlStatements.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('MsSqlSchemaGenerator Specifics', () => {
  const generator = new SqlSchemaGenerator(new MsSqlDialect({}));
  const age = {
    name: 'age',
    type: 'BIGINT',
    nullable: false,
    defaultValue: 18,
    isPrimaryKey: false,
    isAutoIncrement: false,
    isUnique: false,
  };

  it('should add a column without the COLUMN keyword T-SQL rejects', () => {
    expect(generator.generateAlterTable({ tableName: 'users', type: 'alter', columnsToAdd: [age] })).toEqual([
      'ALTER TABLE "users" ADD "age" BIGINT NOT NULL DEFAULT 18;',
    ]);
  });

  it('should spell a stored computed column without its type, as T-SQL does', () => {
    const total = { ...age, name: 'total', nullable: true, defaultValue: undefined, generatedAs: '"qty" * "price"' };
    expect(generator.generateAlterTable({ tableName: 'orders', type: 'alter', columnsToAdd: [total] })).toEqual([
      'ALTER TABLE "orders" ADD "total" AS ("qty" * "price") PERSISTED;',
    ]);
  });

  it('should rename through sp_rename, the new name bare', () => {
    expect(generator.generateRenameColumnSql('users', 'age', 'years')).toBe(
      `EXEC sp_rename N'"users"."age"', N'years', 'COLUMN';`,
    );
    expect(generator.generateRenameTableSql('crm.users', 'people')).toBe(`EXEC sp_rename N'"crm"."users"', N'people';`);
  });

  /** Looked up by column, since the server named each constraint, and differently in every database. */
  it('should drop the constraints pinning a column before the column', () => {
    const [lookup, drop] = generator.generateAlterTable({ tableName: 'users', type: 'alter', columnsToDrop: ['age'] });

    expect(lookup).toMatch(
      /^DECLARE @drop nvarchar\(max\) = \(SELECT STRING_AGG\(N'ALTER TABLE "users" DROP CONSTRAINT '/,
    );
    expect(lookup).toContain('sys.default_constraints');
    expect(lookup).toContain('sys.check_constraints');
    expect(lookup).toContain('sys.key_constraints');
    expect(lookup).toContain(`WHERE c.object_id = OBJECT_ID(N'"users"') AND c.name = N'age') EXEC (@drop);`);
    expect(drop).toBe('ALTER TABLE "users" DROP COLUMN "age";');
  });

  /** A builder splits what it runs on `;`, which must not part the lookup from the `EXEC` it feeds. */
  it('should keep the lookup whole through the split a migration runs it through', () => {
    expect(splitSqlStatements(generator.generateDropColumnSql('users', 'age'))).toHaveLength(2);
  });

  it('should alter a column around its default, which ALTER COLUMN cannot restate', () => {
    const [lookup, alter, restore] = generator.generateAlterColumnStatements('users', age, '');

    expect(lookup).toContain('sys.default_constraints');
    expect(lookup).not.toContain('sys.check_constraints');
    expect(alter).toBe('ALTER TABLE "users" ALTER COLUMN "age" BIGINT NOT NULL;');
    expect(restore).toBe('ALTER TABLE "users" ADD DEFAULT 18 FOR "age";');
  });

  it('should size a type introspection read back apart from its length', () => {
    const name = { ...age, name: 'name', type: 'NVARCHAR', length: 100, nullable: true, defaultValue: undefined };
    expect(generator.generateAlterColumnStatements('users', name, '').slice(1)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "name" NVARCHAR(100) NULL;',
    ]);
  });
});
