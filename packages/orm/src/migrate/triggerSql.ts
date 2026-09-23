import type { AbstractSqlDialect } from '../dialect/index.js';
import type {
  EntityMeta,
  EntityTriggerMeta,
  QueryRaw,
  StampEvent,
  TriggerEvent,
  TriggerMetaBody,
  TriggerRowName,
} from '../type/index.js';
import { stampEvents } from '../util/field.util.js';
import { definedEntries } from '../util/object.util.js';
import { raw, rowColumn, rowRefs } from '../util/raw.js';
import { ownedName } from '../util/sql.util.js';

/** A trigger as uql installs it: the identifier, and the statements creating it under that identifier. */
export type RenderedTrigger = { readonly name: string; readonly statements: readonly string[] };

/**
 * One trigger for `dialect`, named for its table and label and ending in a hash of its own SQL. That hash
 * is the whole of change detection: a trigger is in place exactly when its name is installed, and an
 * edited one is a new name, created while the old one drops as no longer declared.
 */
export function renderTrigger<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  trigger: EntityTriggerMeta<E>,
  position: number,
): RenderedTrigger {
  const table = dialect.resolveTableAlias(meta);
  const label = trigger.name ?? `${trigger.on}_${position}`;
  const draft = triggerStatements(dialect, meta, trigger, label);
  const name = ownedName(table, label, draft.join('\n'));
  return { name, statements: triggerStatements(dialect, meta, trigger, name) };
}

/**
 * What removes one trigger: the trigger, named with its table only where the engine scopes the name to
 * one, and on the Postgres family the function holding its body, which dropping a trigger leaves behind.
 */
export function dropTrigger<E>(dialect: AbstractSqlDialect, meta: EntityMeta<E>, name: string): string[] {
  const { scope, body } = dialect.features.triggers;
  const table = dialect.escapeId(dialect.resolveTableName(meta));
  return [
    `DROP TRIGGER IF EXISTS ${triggerId(dialect, meta, name)}${scope === 'table' ? ` ON ${table}` : ''}`,
    ...(body === 'function' ? [`DROP FUNCTION IF EXISTS ${schemaObjectId(dialect, meta, name)}()`] : []),
  ];
}

/**
 * A trigger's name as its statements spell it: bare where the engine keeps the name under its table,
 * since Postgres refuses a schema there, and in the table's schema where the engine keeps names per
 * schema, or MySQL would look for it in the connection's database and SQL Server in its default schema.
 */
function triggerId<E>(dialect: AbstractSqlDialect, meta: EntityMeta<E>, name: string): string {
  return dialect.features.triggers.scope === 'table' ? dialect.escapeId(name) : schemaObjectId(dialect, meta, name);
}

/** A name in the schema of `meta`'s table, where uql keeps whatever it installs beside it. */
function schemaObjectId<E>(dialect: AbstractSqlDialect, meta: EntityMeta<E>, name: string): string {
  return dialect.escapeQualifiedId(name, dialect.resolveSchema(meta));
}

/**
 * The statements creating one trigger under `name`. Every difference between engines is read off
 * `dialect.features.triggers` rather than branched on a dialect name, so a seventh engine states its
 * shape and renders here unchanged.
 */
function triggerStatements<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  trigger: EntityTriggerMeta<E>,
  name: string,
): string[] {
  const features = dialect.features.triggers;
  // The event, read apart once: `beforeUpdate` is `BEFORE` and `UPDATE`, and everything else follows.
  const before = trigger.on.startsWith('before');
  const operation = trigger.on.slice(before ? 6 : 5).toUpperCase();
  const body = triggerBody(dialect, meta, trigger, before);

  const id = triggerId(dialect, meta, name);
  const table = dialect.escapeId(dialect.resolveTableName(meta));
  const column = (key: string) => dialect.escapeId(dialect.columnOf(meta, key));
  const names = rowNames(dialect);
  const rows = [rowRefs<E>(names.$new), rowRefs<E>(names.$old)] as const;
  const sql = dialect.compileDdl(body(...rows), meta.entity);
  const guard = triggerGuard(dialect, meta, trigger, rows, names, column);

  const inBody = features.guards !== 'clause';
  const guarded =
    !guard || !inBody
      ? sql
      : features.guards === 'beginEnd'
        ? `IF ${guard}\nBEGIN\n${sql}\nEND`
        : `IF ${guard} THEN\n${sql}\nEND IF;`;
  // The preamble opens the body, outside the guard: it settles how the batch reports itself rather than
  // which rows are touched, so it runs even when the guard keeps the statements from running.
  const opened = features.preamble ? `${features.preamble}\n${guarded}` : guarded;

  const of =
    features.guards === 'clause' && operation === 'UPDATE' && trigger.of?.length
      ? ` OF ${trigger.of.map(column).join(', ')}`
      : '';
  const each = features.rows === 'set' ? '' : '\nFOR EACH ROW';
  const clause = guard && !inBody ? `\nWHEN (${guard})` : '';
  const timing = `${before ? 'BEFORE' : 'AFTER'} ${operation}${of}`;
  const header =
    features.layout === 'tableFirst'
      ? `CREATE TRIGGER ${id}\nON ${table} ${timing}${each}${clause}\nAS`
      : `CREATE TRIGGER ${id}\n${timing} ON ${table}${each}${clause}`;

  if (features.body !== 'function') {
    return [`${header}\nBEGIN\n${opened}\nEND`];
  }
  // A `BEFORE` trigger returning NULL discards the write, so it hands back the row it leaves behind;
  // after the write the value is ignored.
  const returned = before ? (operation === 'DELETE' ? names.$old : names.$new) : 'NULL';
  const fn = schemaObjectId(dialect, meta, name);
  return [plpgsqlFunction(fn, `BEGIN\n${opened}\nRETURN ${returned};\nEND`), `${header}\nEXECUTE FUNCTION ${fn}()`];
}

/**
 * The body for the engine in use, refusing first what the engine cannot render at all. One body serves
 * every engine; in a map, one written for the family serves its forks: CockroachDB runs Postgres's
 * PL/pgSQL, MariaDB MySQL's.
 */
function triggerBody<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  trigger: EntityTriggerMeta<E>,
  before: boolean,
): TriggerMetaBody<E> {
  const features = dialect.features.triggers;
  if (before && !features.before) {
    throw new TypeError(
      `${dialect.dialectName} has no BEFORE trigger, only AFTER and INSTEAD OF, so '${trigger.on}' cannot be ` +
        'rendered there. Use the matching after event, which sees the row already written.',
    );
  }
  if (trigger.where && features.rows === 'set') {
    throw new TypeError(
      `${dialect.dialectName} fires a trigger once per statement, over the rows it touched, so no condition ` +
        `can read one row: '${meta.entity.name}' cannot state a trigger 'where' there. Guard inside the body ` +
        'instead, where `inserted` and `deleted` can be read as tables.',
    );
  }
  const { run } = trigger;
  const body = typeof run === 'function' ? run : (run[dialect.dialectName] ?? run[dialect.dialectFamily]);
  if (!body) {
    throw new TypeError(
      `'${meta.entity.name}' has a trigger with no body for ${dialect.dialectName}, the engine in use. ` +
        'Write one for it, or one body for every engine.',
    );
  }
  return body;
}

/** The one condition both guards reduce to: any watched column that moved, and whatever `where` asks. */
function triggerGuard<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  trigger: EntityTriggerMeta<E>,
  rows: Readonly<Parameters<TriggerMetaBody<E>>>,
  names: RowNames,
  column: (key: string) => string,
): string {
  const moved = movedColumns(dialect, meta, trigger.of ?? [], names, column);
  return [
    ...(moved ? [moved] : []),
    ...(trigger.where ? condition(dialect, meta, trigger.where, rows, names, Boolean(moved)) : []),
  ].join(' AND ');
}

/** The PL/pgSQL function holding a body. `OR REPLACE`, since a dropped table leaves its function behind. */
function plpgsqlFunction(id: string, block: string): string {
  const quote = dollarQuote(block);
  return `CREATE OR REPLACE FUNCTION ${id}() RETURNS trigger AS ${quote}\n${block} ${quote} LANGUAGE plpgsql`;
}

/** What the engine calls the rows it hands a trigger: records on a row-based engine, tables on a set-based one. */
function rowNames(dialect: AbstractSqlDialect): RowNames {
  return dialect.features.triggers.rows === 'set'
    ? { $new: 'inserted', $old: 'deleted' }
    : { $new: 'NEW', $old: 'OLD' };
}

/** Keyed as `where` names the rows, so a predicate reads its own row's name directly. */
type RowNames = { readonly $new: TriggerRowName; readonly $old: TriggerRowName };

/**
 * The `where` guard as the terms an `AND` joins. A callback writes its own off the rows; a predicate
 * renders a term per row it names, spelled verbatim because `NEW` is a record the engine declares. Each
 * is an `operand` wherever another term sits beside it, bracketing itself if compound, as `$where` does.
 */
function condition<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  where: NonNullable<EntityTriggerMeta<E>['where']>,
  rows: Readonly<Parameters<TriggerMetaBody<E>>>,
  names: RowNames,
  operand: boolean,
): string[] {
  if (typeof where === 'function') {
    const sql = dialect.compileDdl(where(...rows), meta.entity);
    return [operand ? `(${sql})` : sql];
  }
  const predicates = definedEntries(where);
  return predicates.map(([row, predicate]) => {
    const ctx = dialect.createContext({ inlineValues: true });
    const escapedPrefix = `${names[row]}.`;
    dialect.where(ctx, meta.entity, predicate, {
      clause: false,
      operand: operand || predicates.length > 1,
      escapedPrefix,
    });
    return ctx.sql;
  });
}

/**
 * The triggers a stamp needs: one per event it names, each assigning the field's expression to its
 * column. Generated rather than authored, so unlike an authored body it renders on every engine from
 * one declaration - and not at all on the MySQL family, whose columns stamp themselves.
 */
export function stampTriggers<E>(dialect: AbstractSqlDialect, meta: EntityMeta<E>): EntityTriggerMeta<E>[] {
  const features = dialect.features.triggers;
  // Restating the row has to wait for it to be there, so those engines stamp after the write.
  const after = !features.assignsRow;
  const newName = rowNames(dialect).$new;
  return definedEntries(meta.fields).flatMap(([key, field]) => {
    const events = stampEvents(field);
    const { computed } = field;
    if (!events?.length || !computed) {
      return [];
    }
    return events.map((event): EntityTriggerMeta<E> => ({
      on: STAMP_EVENTS[after ? 'after' : 'before'][event],
      // The event is part of the name: a stamp on both writes installs two triggers, and one identifier
      // between them would have the second replace the first rather than sit beside it.
      name: `${key}_${event}`,
      run: () => stampBody(dialect, meta, key, computed, newName),
    }));
  });
}

/** The trigger event a stamp fires on, by when the engine lets it write and what it stamps. */
const STAMP_EVENTS = {
  before: { insert: 'beforeInsert', update: 'beforeUpdate' },
  after: { insert: 'afterInsert', update: 'afterUpdate' },
} as const satisfies Record<'before' | 'after', Record<StampEvent, TriggerEvent>>;

/** The one statement a stamp runs, in whichever of the two shapes the engine leaves open. */
function stampBody<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  key: string,
  value: QueryRaw,
  newName: TriggerRowName,
): QueryRaw {
  const features = dialect.features.triggers;
  const read = (member: string) => rowColumn(newName, member);
  if (features.assignsRow) {
    const target = read(key);
    return features.body === 'function' ? raw`${target} := ${value};` : raw`SET ${target} = ${value};`;
  }
  const table = dialect.escapeId(dialect.resolveTableName(meta));
  const column = dialect.escapeId(dialect.columnOf(meta, key));
  const keyed = meta.ids
    .map((id) => raw`${text(`${table}.${dialect.escapeId(dialect.columnOf(meta, id))}`)} = ${read(id)}`)
    .reduce((all, part) => raw`${all} AND ${part}`);
  // A set-based engine hands the rows as a table, which an `UPDATE` has to name in a `FROM` before its
  // condition can read one: `inserted."id"` binds to nothing on its own.
  const from = features.rows === 'set' ? ` FROM ${newName}` : '';
  // Only where the stamp still differs: this `UPDATE` fires the trigger again, and with recursive triggers
  // on, the restatement it runs then finds nothing left to change instead of recursing without end.
  const differs = dialect.neExpr(`${table}.${column}`, dialect.compileDdl(value, meta.entity));
  return raw`UPDATE ${text(table)} SET ${text(column)} = ${value}${text(from)} WHERE ${keyed} AND ${text(differs)};`;
}

/** A dollar quote the body does not contain, so no `$$` in it - a literal, a comment - ends the function early. */
function dollarQuote(body: string): string {
  let tag = '$uql$';
  for (let i = 1; body.includes(tag); i++) {
    tag = `$uql${i}$`;
  }
  return tag;
}

/** SQL already written out, for the identifiers a statement splices rather than binds. */
function text(sql: string): QueryRaw {
  return raw((opts) => opts.ctx.append(sql));
}

/**
 * Whether any watched column moved, null-safely, or `undefined` where none is watched: the two records
 * compared on a row-based engine, and on a set-based one the same question over a join of its two tables.
 */
function movedColumns<E>(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<E>,
  of: readonly string[],
  { $new: newName, $old: oldName }: RowNames,
  column: (key: string) => string,
): string | undefined {
  if (!of.length) {
    return undefined;
  }
  const differs = of.map((key) => dialect.neExpr(`${oldName}.${column(key)}`, `${newName}.${column(key)}`));
  const moved = differs.length > 1 ? `(${differs.join(' OR ')})` : differs.join('');
  if (dialect.features.triggers.rows === 'row') {
    return moved;
  }
  const keyed = meta.ids.map((id) => `${newName}.${column(id)} = ${oldName}.${column(id)}`).join(' AND ');
  return `EXISTS (SELECT 1 FROM ${newName} JOIN ${oldName} ON ${keyed} WHERE ${moved})`;
}
