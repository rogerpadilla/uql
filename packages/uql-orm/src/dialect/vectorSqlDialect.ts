import type {
  EntityMeta,
  FieldKey,
  FieldOptions,
  QueryContext,
  QueryVectorSearch,
  VectorDistance,
} from '../type/index.js';
import { entityName } from '../util/object.util.js';
import { AbstractDialect } from './abstractDialect.js';
import { MULTI_VECTOR_TYPE_DIALECTS, type VectorCast } from './vectorCast.js';

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
  readonly vectorExtension: string | undefined = undefined;

  /**
   * Mapping of UQL vector distance metrics to native SQL functions.
   * Override in dialects that use function-call syntax (e.g. SQLite, MariaDB).
   * Dialects with operator-based syntax (e.g. Postgres) leave this empty and override `appendVectorSort` directly.
   */
  protected readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map();

  /** Quotes an identifier; supplied by the SQL dialect built on top of this layer. */
  abstract escapeId(val: string | undefined, forbidQualified?: boolean, addDot?: boolean): string;

  /**
   * Resolve common parameters for a vector similarity ORDER BY expression.
   * Shared by all dialect overrides of `appendVectorSort`.
   */
  protected resolveVectorSortParams<E>(
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): { colName: string; distance: VectorDistance; field: FieldOptions | undefined } {
    const field = meta.fields[key as FieldKey<E>];
    const colName = this.resolveColumnName(key, field);
    const distance = search.$distance ?? field?.distance ?? 'cosine';
    return { colName, distance, field };
  }

  /**
   * Binds a vector, both as a persisted value and as the query vector of a distance expression, so a
   * dialect needing a conversion around it (`$1::vector`, `VEC_FromText(?)`) declares it once.
   */
  protected appendVectorValue(ctx: QueryContext, value: readonly unknown[], _field?: FieldOptions): void {
    ctx.addValue(`[${value.join(',')}]`);
  }

  /**
   * The vector type this dialect actually has for a declared one, so the cast follows the column
   * rather than naming a type the engine does not define. See {@link MULTI_VECTOR_TYPE_DIALECTS}.
   */
  supportedVectorType(cast: VectorCast): VectorCast {
    return MULTI_VECTOR_TYPE_DIALECTS.has(this.dialectName) ? cast : 'vector';
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
    const { colName, distance, field } = this.resolveVectorSortParams(meta, key, search);
    const fn = this.vectorDistanceFns.get(distance);
    if (!fn) {
      throw Error(`${this.dialectName} does not support vector distance metric: ${distance}`);
    }
    ctx.append(`${fn}(${this.escapeId(colName)}, `);
    this.appendVectorValue(ctx, search.$vector, field);
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
    const alias = search.$project!;
    // `$project` names a new column, so it cannot be one the entity already has: both come back
    // under that name and the driver keeps whichever it read last. Checked here rather than in the
    // type because TypeScript cannot say "any string except these".
    if (meta.fields[alias as FieldKey<E>]) {
      throw new TypeError(`$project '${alias}' collides with a field of '${entityName(meta)}'`);
    }
    this.appendVectorSort(ctx, meta, key, search);
    ctx.append(` AS ${this.escapeId(alias)}`);
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
    throw new TypeError(`${this.dialectName} does not support vector similarity sort. Use raw() for vector queries.`);
  }
}
