import type { ForeignKeyAction } from '../../schema/types.js';
import type { ForeignKeySchema, IndexOptions } from '../../type/index.js';
import { declaredIndexName } from '../../util/ddlExpression.util.js';
import { currentTimestamp } from '../../util/sql.js';
import { columnForeignKey, columnIndex, indexDefinition } from '../generator/definitionToNode.js';
import { type TableColumn, tableColumns } from './columnBuilder.js';
import type { IndexDefinition, TableBuilder, TableForeignKeyBuilder } from './types.js';

/** Normalizes `table.index` options, where a bare string is the index name. */
function namedOptions(options?: string | IndexOptions): IndexOptions {
  return typeof options === 'string' ? { name: options } : (options ?? {});
}

/** A table-level foreign key over `columns`, built once its target is named. */
type ForeignKeyDefinition = TableForeignKeyBuilder & { build(): ForeignKeySchema | undefined };

function foreignKeyDefinition(columns: string[]): ForeignKeyDefinition {
  let references: ForeignKeySchema['references'] | undefined;
  let onDelete: ForeignKeyAction | undefined;
  let onUpdate: ForeignKeyAction | undefined;
  let name: string | undefined;
  return {
    references(table, referenced) {
      references = { table, columns: referenced };
      return this;
    },
    onDelete(action) {
      onDelete = action;
      return this;
    },
    onUpdate(action) {
      onUpdate = action;
      return this;
    },
    name(constraint) {
      name = constraint;
      return this;
    },
    build() {
      if (!references) return undefined;
      return { name, columns, references, onDelete, onUpdate };
    },
  };
}

/** A table as `createTable`'s callback declares it: its columns in `f`'s vocabulary, then what spans several. */
export function tableBuilder(name: string): TableBuilder {
  const columns: TableColumn[] = [];
  const indexes: IndexDefinition[] = [];
  const foreignKeyBuilders: ForeignKeyDefinition[] = [];
  let primaryKey: string[] | undefined;
  let comment: string | undefined;
  const factory = tableColumns((column) => {
    columns.push(column);
    return column;
  });
  const timestampNow = (column: string) => factory.timestamptz(column).default(currentTimestamp);

  return {
    ...factory,
    createdAt: () => timestampNow('createdAt'),
    updatedAt: () => timestampNow('updatedAt'),
    timestamps() {
      timestampNow('createdAt');
      timestampNow('updatedAt');
    },
    primaryKey(keyColumns) {
      primaryKey = keyColumns;
      return this;
    },
    unique(entries, options) {
      indexes.push(indexDefinition(entries, { ...namedOptions(options), unique: true }, true));
      return this;
    },
    index(entries, options) {
      indexes.push(indexDefinition(entries, namedOptions(options)));
      return this;
    },
    foreignKey(keyColumns) {
      const foreignKey = foreignKeyDefinition(keyColumns);
      foreignKeyBuilders.push(foreignKey);
      return foreignKey;
    },
    comment(text) {
      comment = text;
      return this;
    },
    build() {
      const built = columns.map((column) => column.build());
      // Column-level indexes, skipping one a table-level index already names.
      const taken = new Set(
        indexes
          .filter((index) => index.where === undefined)
          .map((index) => declaredIndexName(index.name, name, index.entries, { unique: index.uniqueName })),
      );
      const columnIndexes = built.flatMap((column) => {
        const index = columnIndex(name, column);
        if (!index || taken.has(index.name)) return [];
        taken.add(index.name);
        return [index];
      });
      const foreignKeys = [
        ...foreignKeyBuilders.map((foreignKey) => foreignKey.build()),
        ...built.map(columnForeignKey),
      ].filter((foreignKey): foreignKey is ForeignKeySchema => foreignKey !== undefined);
      return { name, columns: built, primaryKey, indexes: [...indexes, ...columnIndexes], foreignKeys, comment };
    },
  };
}
