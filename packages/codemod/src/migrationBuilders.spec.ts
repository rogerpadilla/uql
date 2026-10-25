import type { TableColumnFactory } from 'uql-orm/migrate/index.js';
import { describe, expect, it } from 'vitest';
import { FACTORY_NAMES, toMigrationBuilders } from './migrationBuilders.js';

/** Fails to compile where the codemod's factory list and the table builder's factories part. */
type FactoryName = (typeof FACTORY_NAMES)[number];
const factoriesMatch: [
  Exclude<keyof TableColumnFactory, FactoryName>,
  Exclude<FactoryName, keyof TableColumnFactory>,
] extends [never, never]
  ? true
  : false = true;

const build = (text: string) => toMigrationBuilders('/migration.ts', text);

describe('toMigrationBuilders', () => {
  it("should know every column factory a migration's table builder has", () => {
    expect(factoriesMatch).toBe(true);
  });

  it("should write a migration's columns in an entity column's vocabulary", () => {
    const { text, unresolved } = build(`export default {
  async up(builder) {
    await builder.createTable('users', (table) => {
      table.id();
      table.string('email', { length: 80, unique: true }).notNullable();
      table.string('bio', { nullable: true });
      table.decimal('total', { precision: 10, scale: 2, defaultValue: 0 });
      table.vector('embedding', { dimensions: 3 }).nullable(true);
      table.integer('companyId', { index: 'by_company', references: { table: 'companies', onDelete: 'CASCADE' } });
      table.text('shout').computed('upper(email)').nullable(false);
      table.uuid('ref', { primaryKey: true, comment: 'the key', unsigned: false, autoIncrement: true });
      table.timestamptz('at').defaultValue(sql\`now()\`).primaryKey();
      table.primaryKey(['id']);
      other.string('x', { length: 1 });
    });
    await builder.addColumn('users', (columns) => columns.boolean('live', { index: true }));
  },
};`);
    expect(unresolved).toEqual([]);
    expect(text).toBe(`export default {
  async up(builder) {
    await builder.createTable('users', (table) => {
      table.id();
      table.string('email').length(80).unique();
      table.string('bio').nullable();
      table.decimal('total').precision(10).scale(2).default(0);
      table.vector('embedding', 3).nullable();
      table.integer('companyId').index('by_company').references('companies').onDelete('CASCADE');
      table.text('shout').as('upper(email)');
      table.uuid('ref').id().autoIncrement().comment('the key');
      table.timestamptz('at').default(sql\`now()\`).id();
      table.primaryKey(['id']);
      other.string('x', { length: 1 });
    });
    await builder.addColumn('users', (columns) => columns.boolean('live').index());
  },
};`);
  });

  it('should leave what it cannot read as it is, and say why', () => {
    const input = `await builder.alterTable('users', (table) => {
  table.string('a', shared);
  table.string('b', { frob: 1 });
  table.integer('c', { references: ref });
  table.integer('d', { references: { column: 'id' } });
  table.string('e', { ...shared });
  table.string('f', { [key]: 1 });
  table.string('g', { unique: isUnique });
});`;
    const { text, unresolved } = build(input);
    expect(text).toBe(input);
    expect(unresolved).toEqual([
      "/migration.ts:2: cannot write 'shared' as the column's methods: chain each option as one",
      '/migration.ts:3: has options no column method writes: frob',
      "/migration.ts:4: cannot write 'ref' as '.references(table, column)'",
      "/migration.ts:5: cannot write '{ column: 'id' }' as '.references(table, column)'",
      "/migration.ts:6: cannot write '{ ...shared }' as the column's methods: chain each option as one",
      "/migration.ts:7: cannot write '{ [key]: 1 }' as the column's methods: chain each option as one",
      "/migration.ts:8: cannot write 'unique: isUnique' as a method: chain it, or not, by hand",
    ]);
  });

  it('should drop a flag stated false, a column being without it already', () => {
    const { text } = build(`await builder.createTable('t', (table) => {
  table.integer('n', { nullable: false, primaryKey: false, autoIncrement: false, unique: false, unsigned: false, index: false });
  table.integer('m', { references: { table: 't', column: 'n', onUpdate: 'CASCADE' } });
  table.vector('v', { nullable: true }).unique();
});`);
    expect(text).toBe(`await builder.createTable('t', (table) => {
  table.integer('n');
  table.integer('m').references('t', 'n').onUpdate('CASCADE');
  table.vector('v').nullable().unique();
});`);
  });

  it('should leave a file with no migration in it alone', () => {
    expect(build('table.string("x", { length: 1 });')).toEqual({
      text: 'table.string("x", { length: 1 });',
      unresolved: [],
    });
  });
});
