import { OWNED_PREFIX } from '../../dialect/aliases.js';
import type { AbstractSqlDialect } from '../../dialect/index.js';
import type { RebuiltTable, Rename } from '../../type/index.js';

/** The table a rebuild copies into, under a name no entity's table takes. */
const NEW_TABLE_PREFIX = `${OWNED_PREFIX}_new_`;

/** The table the guard inserts into, refused while foreign keys would take rows down with the rebuilt one. */
const GUARD_TABLE = `${OWNED_PREFIX}_rebuild_guard`;

/** What the copy reads besides the columns both sides share: renamed ones, and a default filling a column's nulls. */
export type RebuildCopy = {
  readonly renames: readonly Rename[];
  readonly fills: ReadonlyMap<string, string>;
};

/**
 * SQLite's documented rebuild of `table`: a new table in the shape `to` gives, the rows copied into it,
 * the old one dropped and the new one renamed into its place, then its indexes and triggers. A foreign
 * key pointing at the table would delete or null its rows with the drop, so the guard fails the whole
 * rebuild first unless foreign keys are off, as the migrator turns them off on a SQLite connection.
 */
export function rebuildTable(
  dialect: AbstractSqlDialect,
  table: string,
  { from, to }: { readonly from: RebuiltTable; readonly to: RebuiltTable },
  copy: RebuildCopy,
): string[] {
  const id = (name: string) => dialect.escapeId(name);
  const target = id(`${NEW_TABLE_PREFIX}${table}`);
  const [create, ...rest] = to.statements;
  const copied = to.columns.flatMap((column) => {
    const source = copy.renames.find((rename) => rename.to === column)?.from ?? column;
    if (!from.columns.includes(source)) {
      return [];
    }
    const fill = copy.fills.get(column);
    return [{ column: id(column), value: fill === undefined ? id(source) : `coalesce(${id(source)}, ${fill})` }];
  });
  return [
    ...guard(dialect, table),
    renameCreatedTable(create, target),
    ...(copied.length
      ? [
          `INSERT INTO ${target} (${copied.map((it) => it.column).join(', ')}) ` +
            `SELECT ${copied.map((it) => it.value).join(', ')} FROM ${id(table)};`,
        ]
      : []),
    `DROP TABLE ${id(table)};`,
    `ALTER TABLE ${target} RENAME TO ${id(table)};`,
    ...rest,
  ];
}

/** Fails, naming the way out, where foreign keys are on and any table references `table`. */
function guard(dialect: AbstractSqlDialect, table: string): string[] {
  const id = (name: string) => dialect.escapeId(name);
  const guardTable = id(GUARD_TABLE);
  const referencing = id('referencing');
  const refusal = id(`turn foreign keys off to rebuild ${table}: the rows referencing it would be lost`);
  return [
    `CREATE TABLE IF NOT EXISTS ${guardTable} (${referencing} INTEGER CONSTRAINT ${refusal} CHECK (${referencing} = 0));`,
    `INSERT INTO ${guardTable} SELECT count(*) FROM pragma_foreign_keys AS k, sqlite_master AS m, ` +
      `pragma_foreign_key_list(m.name) AS f WHERE k.foreign_keys AND m.type = 'table' ` +
      `AND f.${id('table')} = ${dialect.escape(table)} COLLATE NOCASE;`,
    `DROP TABLE ${guardTable};`,
  ];
}

const CREATE_TABLE_NAME =
  /^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[^\s(]+)/i;

/** A `CREATE TABLE` as the engine or the generator spelled it, creating `name` instead. */
function renameCreatedTable(sql: string, name: string): string {
  return sql.replace(CREATE_TABLE_NAME, `$1${name}`);
}
