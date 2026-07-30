import type {
  EntityMeta,
  FieldKey,
  FieldOptions,
  QueryContext,
  QueryVectorSearch,
  VectorDistance,
} from '../type/index.js';
import { AbstractDialect } from './abstractDialect.js';
import { resolveVectorCast, type VectorCast } from './vectorCast.js';

/**
 * Vector similarity search for SQL dialects: the `ORDER BY <distance>` expression, its projection as
 * a named score, and the index metadata the schema generator reads.
 *
 * A layer of its own because it is nearly self-contained - it needs only `escapeId` from the SQL
 * dialect above it - unlike the JSON operators, which are woven into the generic comparison
 * machinery (`neExpr`, `numericCast`, `formatIn`, ...) and belong with it.
 *
 * Two shapes exist across dialects: an operator (`"col" <=> $1`, Postgres/CockroachDB) or a function
 * call (`VEC_DISTANCE_COSINE(col, ?)`, MariaDB/SQLite). Dialects pick one by either overriding
 * {@link appendVectorSort} or filling {@link vectorDistanceFns}.
 */
export abstract class VectorSqlDialect extends AbstractDialect {
  /** Vector index operator classes, keyed by distance metric. Partial: not every dialect supports every metric. */
  readonly vectorOpsClass: ReadonlyMap<VectorDistance, string> | undefined = undefined;

  readonly vectorExtension: string | undefined = undefined;

  /**
   * Mapping of UQL vector distance metrics to native SQL functions.
   * Override in dialects that use function-call syntax (e.g. SQLite, MariaDB).
   * Dialects with operator-based syntax (e.g. Postgres) leave this empty and override `appendVectorSort` directly.
   */
  protected readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map();

  /** Quotes an identifier; supplied by the SQL dialect built on top of this layer. */
  abstract escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string;

  /**
   * Resolve common parameters for a vector similarity ORDER BY expression.
   * Shared by all dialect overrides of `appendVectorSort`.
   */
  protected resolveVectorSortParams<E>(
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): { colName: string; distance: VectorDistance; field: FieldOptions | undefined; vectorCast: VectorCast } {
    const field = meta.fields[key as FieldKey<E>];
    const colName = this.resolveColumnName(key, field);
    const distance = search.$distance ?? field?.distance ?? 'cosine';
    const vectorCast = resolveVectorCast(field);
    return { colName, distance, field, vectorCast };
  }

  /**
   * Append a vector similarity function call: `fn(col, ?)`.
   * Used by dialects that express vector distance via SQL functions (SQLite, MariaDB).
   */
  protected appendFunctionVectorSort<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): void {
    const { colName, distance } = this.resolveVectorSortParams(meta, key, search);
    const fn = this.vectorDistanceFns.get(distance);
    if (!fn) {
      throw Error(`${this.dialectName} does not support vector distance metric: ${distance}`);
    }
    ctx.append(`${fn}(${this.escapeId(colName)}, `);
    ctx.addValue(`[${search.$vector.join(',')}]`);
    ctx.append(')');
  }

  /**
   * Append a vector distance projection.
   * Delegates to `appendVectorSort` so each dialect's distance syntax is written once.
   */
  protected appendVectorProjection<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): void {
    this.appendVectorSort(ctx, meta, key, search);
    ctx.append(` AS ${this.escapeId(search.$project!)}`);
  }

  /**
   * Append a vector similarity expression for `ORDER BY`.
   * Default: auto-delegates to `appendFunctionVectorSort` when `vectorDistanceFns` has entries.
   */
  protected appendVectorSort<E>(ctx: QueryContext, meta: EntityMeta<E>, key: string, search: QueryVectorSearch): void {
    if (this.vectorDistanceFns.size > 0) {
      this.appendFunctionVectorSort(ctx, meta, key, search);
      return;
    }
    throw new TypeError('Vector similarity sort is not supported by this dialect. Use raw() for vector queries.');
  }
}
