import { describe, expect, it } from 'vitest';
import { Entity, f, Field, getMeta } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { PolicySchema, TableNode } from '../schema/types.js';
import { assertDefined } from '../test/index.js';
import type { Type } from '../type/index.js';
import { $context } from '../util/contextRefs.js';
import { renderPolicies } from './policySql.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

const dialect = new PostgresDialect({ policies: 'native' });
const text = () => 'text';

describe('renderPolicies', () => {
  it('should hold a policy whose when lists no value under no context', () => {
    @Entity({ policies: [{ allow: {}, when: { role: [] } }] })
    class Nobody {
      @Field(f.number().autoIncrement()) id?: number;
    }
    const [policy] = renderPolicies(dialect, getMeta(Nobody), text);
    expect(policy!.statements.at(-1)).toContain('USING (false)');
  });

  it('should refuse a context key compared with what is no field', () => {
    const unknownField = { allow: { ghost: { $context: 'userId' } } } as const;
    @Entity({ policies: [unknownField as never] })
    class Haunted {
      @Field(f.number().autoIncrement()) id?: number;
    }
    expect(() => renderPolicies(dialect, getMeta(Haunted), text)).toThrow(
      "a policy of 'Haunted' compares context key 'userId' with no field",
    );
  });
});

describe('policy migrations', () => {
  const generator = new SqlSchemaGenerator(dialect);

  @Entity({
    name: 'Ticket',
    policies: [{ must: { ownerId: { $ne: '' } } }, { allow: { ownerId: $context.userId } }],
  })
  class Ticket {
    @Field(f.number().autoIncrement()) id?: number;
    @Field(f.string()) ownerId?: string;
    @Field(f.string().nullable()) note?: string | null;
  }

  @Entity({ name: 'Ticket' })
  class OpenTicket {
    @Field(f.number().autoIncrement()) id?: number;
    @Field(f.string()) ownerId?: string;
    @Field(f.string().nullable()) note?: string | null;
  }

  /** `entity`'s table as the database reports it, holding `installed` for policies. */
  const installed = (entity: Type<object>, ...policies: PolicySchema[]) => {
    const table = generator.buildAST([entity]).getTable('Ticket');
    assertDefined(table);
    table.policies.splice(0, table.policies.length, ...policies);
    return table;
  };
  const declared = () => generator.buildAST([Ticket]).getTable('Ticket')!.policies;
  const alter = (entity: Type<object>, table: TableNode) => {
    const diff = generator.diffSchema(entity, table);
    assertDefined(diff);
    return generator.generateAlterTable(diff);
  };

  it('should enable and force row-level security once per table, ahead of its policies', () => {
    const sql = generator.generateCreateSchema([Ticket]);
    expect(sql.filter((statement) => statement.includes('ROW LEVEL SECURITY'))).toEqual([
      'ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;',
    ]);
    expect(sql.findIndex((it) => it.includes('ENABLE ROW'))).toBeLessThan(
      sql.findIndex((it) => it.startsWith('CREATE POLICY')),
    );
  });

  it('should enable row-level security where a table gets its first policy', () => {
    expect(alter(Ticket, installed(Ticket))).toEqual([
      'ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;',
      ...declared().flatMap((policy) => policy.statements.map((statement) => `${statement};`)),
    ]);
  });

  // Forced with no policy left, the table would show no row to anyone, its owner included.
  it('should disable row-level security where a table loses its last policy', () => {
    expect(alter(OpenTicket, installed(OpenTicket, ...declared()))).toEqual([
      ...declared().map((policy) => `DROP POLICY IF EXISTS "${policy.name}" ON "Ticket";`),
      'ALTER TABLE "Ticket" NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;',
    ]);
  });

  // Postgres refuses to retype or drop a column a policy reads, so a kept one comes off and goes back on.
  it('should take a kept policy off around a column it reads', () => {
    const table = installed(Ticket, ...declared());
    const ownerId = table.columns.get('ownerId');
    assertDefined(ownerId);
    table.columns.set('ownerId', { ...ownerId, nullable: true });
    const sql = alter(Ticket, table);
    expect(sql[0]).toMatch(/^DROP POLICY IF EXISTS "_uql_Ticket__/);
    expect(sql.at(-1)).toMatch(/^CREATE POLICY/);
  });

  it('should leave a kept policy on around a column it does not read', () => {
    const table = installed(Ticket, ...declared());
    const note = table.columns.get('note');
    assertDefined(note);
    table.columns.set('note', { ...note, nullable: false });
    expect(alter(Ticket, table)).toEqual(['ALTER TABLE "Ticket" ALTER COLUMN "note" DROP NOT NULL;']);
  });
});
