import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildSqlQuerierMigrationModule, emitSqlRunCall, emitSqlRunCalls } from './migrationFile.js';

function assertEmittedRunCallParses(sql: string): void {
  const line = emitSqlRunCall(sql);
  const src = `async function _migrationUp(querier) {\n${line}\n}`;
  expect(() => new vm.Script(src)).not.toThrow();
}

describe('emitSqlRunCall', () => {
  it('LibSQL/SQLite backtick identifiers (invalid if embedded in unescaped template literal)', () => {
    const sql = 'CREATE TABLE `Article` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\n  `title` TEXT NOT NULL\n);';
    expect(emitSqlRunCall(sql)).toBe(
      '    await querier.run("CREATE TABLE `Article` (\\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\\n  `title` TEXT NOT NULL\\n);");',
    );
    assertEmittedRunCallParses(sql);
  });

  it('emitSqlRunCalls joins one run() line per statement (#87)', () => {
    expect(emitSqlRunCalls(['SELECT 1;', 'SELECT 2;'])).toBe(
      [emitSqlRunCall('SELECT 1;'), emitSqlRunCall('SELECT 2;')].join('\n'),
    );
  });

  it('emitSqlRunCall per statement: index separate from table (#87 style)', () => {
    const table = 'CREATE TABLE `Article` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\n  `title` TEXT\n);';
    const index = 'CREATE INDEX `idx_Article_title` ON `Article` (`title`);';
    const block = emitSqlRunCalls([table, index]);
    expect(block).toContain('await querier.run("CREATE TABLE `Article`');
    expect(block).toContain('await querier.run("CREATE INDEX `idx_Article_title`');
    expect(() => new vm.Script(`async function _up(querier) {\n${block}\n}`)).not.toThrow();
  });

  it('Postgres-style double-quoted identifiers', () => {
    const sql = 'ALTER TABLE "users" ADD COLUMN "age" INTEGER;';
    expect(emitSqlRunCall(sql)).toBe('    await querier.run("ALTER TABLE \\"users\\" ADD COLUMN \\"age\\" INTEGER;");');
    assertEmittedRunCallParses(sql);
  });

  it('literal ${ in SQL must not break generated source', () => {
    const sql = "INSERT INTO t VALUES ('${not_template_literal}');";
    expect(emitSqlRunCall(sql)).toBe('    await querier.run("INSERT INTO t VALUES (\'${not_template_literal}\');");');
    assertEmittedRunCallParses(sql);
  });

  it('backslashes and quotes', () => {
    const sql = String.raw`SELECT '\\' AS x, "'" AS y;`;
    // Two backslashes inside the JSON string literal → four `\` in this template source.
    expect(emitSqlRunCall(sql)).toBe(`    await querier.run("SELECT '\\\\\\\\' AS x, \\"'\\" AS y;");`);
    assertEmittedRunCallParses(sql);
  });
});

describe('buildSqlQuerierMigrationModule', () => {
  it('includes doc extras and emitted run calls', () => {
    const src = buildSqlQuerierMigrationModule({
      migrationName: 'add_foo',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      docExtraLines: ['Generated from entity definitions'],
      upInner: emitSqlRunCall('SELECT 1;'),
      downInner: emitSqlRunCall('SELECT 2;'),
    });
    expect(src).toContain('* Generated from entity definitions');
    expect(src).toContain('await querier.run("SELECT 1;");');
    expect(src).toContain('await querier.run("SELECT 2;");');
    expect(src).toContain('Migration: add_foo');
    expect(src).toContain('Created: 2026-01-01T00:00:00.000Z');
  });
});
