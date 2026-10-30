import { getMeta } from '../entity/index.js';
import type {
  EntityMeta,
  FieldKey,
  Key,
  QueryConflictKeys,
  QueryUpsert,
  QueryContext,
  QueryPager,
  TriggerRows,
  AbstractType,
} from '../type/index.js';
import { assertNonNegativeInteger, getKeys } from '../util/index.js';
import { AbstractSqlDialect, type ConflictUpdate, fromRows, type SelectTerm } from './abstractSqlDialect.js';
import { UPSERT_SOURCE_ALIAS } from './aliases.js';

/** What SQL Server and Oracle share: paging and upsert spelled as the standard does. */
export abstract class MergeSqlDialect extends AbstractSqlDialect {
  override readonly escapeIdChar = '"';

  /** `OFFSET ... FETCH NEXT`, and a constant `ORDER BY` where there is none, since SQL Server refuses to page without one. */
  override pager(ctx: QueryContext, opts: QueryPager & { $distinct?: boolean }, sorted = false): void {
    if (opts.$limit === undefined && opts.$skip === undefined) {
      return;
    }
    if (!sorted) {
      // A `SELECT DISTINCT` may only order by something it projects, so the constant cannot be used
      // there; the first projected column is the one term always available.
      ctx.append(` ORDER BY ${opts.$distinct ? '1' : '(SELECT NULL)'}`);
    }
    ctx.append(` OFFSET ${assertNonNegativeInteger(opts.$skip ?? 0, '$skip')} ROWS`);
    if (opts.$limit !== undefined) {
      ctx.append(` FETCH NEXT ${assertNonNegativeInteger(opts.$limit, '$limit')} ROWS ONLY`);
    }
  }

  /**
   * `MERGE` with its rows as a `VALUES` source built by {@link AbstractSqlDialect.insertShape}. The update
   * assignments bind their values before the rows, though they follow them in the SQL; this works only because
   * SQL Server numbers each placeholder (`@p1`).
   */
  override upsert<E>(
    ctx: QueryContext,
    entity: AbstractType<E>,
    q: QueryUpsert<E>,
    payload: E | E[],
    returning?: readonly FieldKey<E>[],
  ): readonly SelectTerm[] {
    const meta = getMeta(entity);
    // Before the row source, which is what fills the payload's `onInsert` fields: a column that
    // exists only there - the generated key, `createdAt` - must not join the update set, or a row
    // that already existed has both rewritten.
    const found = this.conflictUpdate(ctx, entity, q, payload);
    return this.reportedWrite(ctx, entity, returning, 'upsert', (afterTarget) => {
      const shape = this.insertShape(entity, payload);
      ctx.append(`MERGE INTO ${this.escapedTableName(meta)}${this.mergeTargetHint} USING (VALUES `);
      this.appendValueRows(ctx, shape);
      ctx.append(`)${this.mergeMatch(meta, q.$conflict, shape.columns, found)}`);
      // A report ends the statement itself, before the read of what it reported.
      ctx.append(afterTarget ? ` ${afterTarget}` : this.statementTerminator);
    });
  }

  /** A trigger's upsert as a `MERGE` of the rows it was handed, `SELECT`ed off them as its source. */
  protected override appendTriggerUpsert<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    conflictKeys: QueryConflictKeys<E>,
    entries: readonly [string, unknown][],
    found: ConflictUpdate,
    rows?: TriggerRows,
  ): void {
    ctx.append(`MERGE INTO ${this.escapedTableName(meta)}${this.mergeTargetHint} USING (SELECT `);
    this.appendTriggerValues(ctx, meta, entries);
    const columns = entries.map(([key]) => this.escapedColumnName(meta, key));
    ctx.append(`${rows ? fromRows(rows) : ''})${this.mergeMatch(meta, conflictKeys, columns, found)};`);
  }

  /**
   * The rest of a `MERGE` once its source is written: the source named, matched on the conflict keys, updated
   * as `found` says where it matched and its condition holds, if it assigns anything, and inserted where it did not.
   */
  private mergeMatch<E>(
    meta: EntityMeta<E>,
    conflictKeys: QueryConflictKeys<E>,
    columns: readonly string[],
    { assignments, condition }: ConflictUpdate,
  ): string {
    const table = this.escapedTableName(meta);
    const source = this.escapeId(UPSERT_SOURCE_ALIAS, true);
    const matched = assignments
      ? ` WHEN MATCHED${condition && ` AND ${condition}`} THEN UPDATE SET ${assignments}`
      : '';
    const values = columns.map((col) => `${source}.${col}`).join(', ');
    return (
      ` AS ${source} (${columns.join(', ')}) ON ${this.mergeOn(meta, conflictKeys, table, source)}${matched}` +
      ` WHEN NOT MATCHED THEN INSERT (${columns.join(', ')}) VALUES (${values})`
    );
  }

  /** The source row through the alias `MERGE` gives it. */
  protected override upsertIncoming(column: string): string {
    return `${this.escapeId(UPSERT_SOURCE_ALIAS, true)}.${column}`;
  }

  /** `<target>.<col> = <source>.<col>` for every conflict key, which is what makes a row "the same". */
  private mergeOn<E>(meta: EntityMeta<E>, conflictKeys: QueryConflictKeys<E>, table: string, source: string): string {
    return (getKeys(conflictKeys) as Key<E>[])
      .map((key) => {
        const column = this.escapeId(this.resolveColumnName(key, meta.fields[key]));
        return `${table}.${column} = ${source}.${column}`;
      })
      .join(' AND ');
  }

  /**
   * A lock hint on the merge target. `MERGE` takes an update key lock but releases it before the
   * insert, so two concurrent upserts of the same key race into a duplicate-key error; `HOLDLOCK`
   * holds it across both. Empty on Oracle, which does not have the hint and does not need it.
   */
  protected readonly mergeTargetHint: string = '';

  /** `MERGE` must be terminated on SQL Server; nothing else here cares. */
  protected readonly statementTerminator: string = '';
}
