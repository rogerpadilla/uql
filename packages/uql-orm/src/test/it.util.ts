import { getEntities } from '../entity/index.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import type { AbstractSqlQuerier } from '../querier/index.js';
import { SchemaASTBuilder } from '../schema/schemaASTBuilder.js';
import type { TableNode } from '../schema/types.js';

/**
 * The fixture schema, built from the mock entities by the same generator migrations use, so the
 * integration suites run against the columns a real migration would create rather than a
 * hand-rolled approximation of them (which mapped a vector column to `vector(3)` everywhere,
 * a type no SQLite-family engine has).
 */
function buildSchema(querier: AbstractSqlQuerier) {
  const generator = new SqlSchemaGenerator(querier.dialect);
  const ast = new SchemaASTBuilder(querier.dialect.namingStrategy).fromEntities(getEntities());
  return { generator, ast };
}

export async function createTables(querier: AbstractSqlQuerier) {
  const { generator, ast } = buildSchema(querier);
  await querier.transaction(async () => {
    for (const table of ast.getCreateOrder()) {
      // Without the foreign keys: the shared suites insert rows whose `companyId`/`creatorId` point
      // at no row on purpose, being about ORM behavior rather than referential integrity.
      const fkFree: TableNode = { ...table, outgoingRelations: [] };
      for (const sql of generator.generateCreateTableFromNode(fkFree, { ifNotExists: true })) {
        await querier.run(sql);
      }
    }
  });
}

export async function dropTables(querier: AbstractSqlQuerier) {
  const { generator, ast } = buildSchema(querier);
  await querier.transaction(async () => {
    for (const table of ast.getDropOrder()) {
      await querier.run(generator.generateDropTable(table.name, { ifExists: true }));
    }
  });
}

export async function clearTables(querier: AbstractSqlQuerier) {
  const { ast } = buildSchema(querier);
  await querier.transaction(async () => {
    // Drop order: a referenced row cannot go before the rows pointing at it.
    for (const table of ast.getDropOrder()) {
      await querier.run(`DELETE FROM ${querier.dialect.escapeId(table.name)}`);
    }
    // `INTEGER PRIMARY KEY AUTOINCREMENT` keeps its high-water mark in `sqlite_sequence` across a
    // DELETE, so without this the ids a suite sees depend on which tests ran before it.
    if (querier.dialect.dialectName === 'sqlite') {
      await querier.run('DELETE FROM sqlite_sequence');
    }
  });
}
