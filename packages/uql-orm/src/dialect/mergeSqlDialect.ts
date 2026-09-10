import { getMeta } from '../entity/index.js';
import type { EntityMeta, Key, QueryConflictPaths, QueryContext, QueryPager, Type } from '../type/index.js';
import { assertNonNegativeInteger, getKeys } from '../util/index.js';
import { AbstractSqlDialect } from './abstractSqlDialect.js';
import { UPSERT_SOURCE_ALIAS } from './aliases.js';

/**
 * Shared SQL between SQL Server and Oracle: the two engines that spell paging and upsert the way the
 * standard does, where the Postgres and MySQL families each predate it.
 *
 * A family base rather than a pair of knobs, the way {@link PgLikeSqlDialect} and
 * {@link MysqlLikeSqlDialect} already are - `pager` and `upsert` are both plain overrides, so nothing
 * in the core has to learn that a second spelling exists.
 */
export abstract class MergeSqlDialect extends AbstractSqlDialect {
  override readonly escapeIdChar = '"';

  /**
   * `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY`, and an `ORDER BY` where the statement has none.
   *
   * SQL Server refuses to page an unordered statement. A constant `ORDER BY` costs one clause the
   * optimizer discards and keeps `$limit` and `$skip` meaning the same thing here as everywhere
   * else; the alternative, `TOP (n)` in the select list, needs a second hook and still leaves a
   * `$skip` with no `$sort` unanswerable.
   */
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
   * `MERGE`, which both engines take in place of the `ON CONFLICT`/`ON DUPLICATE KEY` the other
   * families have. The rows go in as a `VALUES` row source rather than an `INSERT`, built by
   * {@link AbstractSqlDialect.insertShape} so both shapes apply `onInsert` defaults identically.
   *
   * Every value binds before the assignments are rendered, so a `?`-placeholder engine needs none of
   * the scratch-context reordering `ON CONFLICT` does - the source is read positionally, in order.
   */
  override upsert<E>(
    ctx: QueryContext,
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    extraReturning = '',
  ): void {
    const meta = getMeta(entity);
    const table = this.escapedTableName(meta);
    const source = this.escapeId(UPSERT_SOURCE_ALIAS, true);
    // Before the row source, which is what fills the payload's `onInsert` fields: a column that
    // exists only there - the generated key, `createdAt` - must not join the update set, or a row
    // that already existed has both rewritten.
    const update = this.getUpsertUpdateAssignments(ctx, meta, conflictPaths, payload, (col) => `${source}.${col}`);
    const shape = this.insertShape(entity, payload);
    const columns = shape.columns.join(', ');

    ctx.append(`MERGE INTO ${table}${this.mergeTargetHint} USING (VALUES `);
    this.appendValueRows(ctx, shape);
    ctx.append(`) AS ${source} (${columns}) ON ${this.mergeOn(meta, conflictPaths, table, source)}`);
    if (update) {
      ctx.append(` WHEN MATCHED THEN UPDATE SET ${update}`);
    }
    ctx.append(
      ` WHEN NOT MATCHED THEN INSERT (${columns}) VALUES (${shape.columns.map((col) => `${source}.${col}`).join(', ')})`,
    );

    const returning = [this.returningIdExpression(meta), extraReturning].filter(Boolean).join(', ');
    if (returning) {
      ctx.append(` ${this.mergeReturning(returning)}`);
    }
    ctx.append(this.statementTerminator);
  }

  /** `<target>.<col> = <source>.<col>` for every conflict key, which is what makes a row "the same". */
  private mergeOn<E>(meta: EntityMeta<E>, conflictPaths: QueryConflictPaths<E>, table: string, source: string): string {
    return (getKeys(conflictPaths) as Key<E>[])
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

  /** How the merge reports the row it wrote. Oracle has no such clause on a `MERGE` and omits it. */
  protected mergeReturning(expression: string): string {
    return `RETURNING ${expression}`;
  }

  /** `MERGE` must be terminated on SQL Server; nothing else here cares. */
  protected readonly statementTerminator: string = '';
}
