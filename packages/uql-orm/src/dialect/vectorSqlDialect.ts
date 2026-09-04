import type {
  EntityIndexMeta,
  EntityMeta,
  FieldKey,
  FieldOptions,
  Query,
  QueryContext,
  QueryVectorSearch,
  VectorDistance,
  VectorMetric,
} from '../type/index.js';
import { unsupportedVectorMetric } from '../type/vector.js';
import { findVectorIndex, findVectorSort } from '../util/dialect.util.js';
import { entityName } from '../util/object.util.js';
import { AbstractDialect } from './abstractDialect.js';
import type { VectorCast } from './vectorCast.js';

/**
 * Vector similarity search for SQL dialects: the `ORDER BY <distance>` expression, its projection as
 * a named score, and the index metadata the schema generator reads.
 *
 * A layer of its own because it is nearly self-contained - it needs only `escapeId` from the SQL
 * dialect above it - unlike the JSON operators, which are woven into the generic comparison
 * machinery (`neExpr`, `numericCast`, `formatIn`, ...) and belong with it.
 *
 * A dialect declares which metrics it has, and how it spells each, in {@link vectorMetrics}. Both
 * shapes live in that one map - an operator (`"col" <=> $1`, Postgres/CockroachDB) or a function call
 * (`VEC_DISTANCE_COSINE(col, ?)`, MariaDB/SQLite) - so {@link appendVectorSort} is written once and an
 * engine with no vector search at all is simply the empty map.
 */
export abstract class VectorSqlDialect extends AbstractDialect {
  readonly vectorExtension: string | undefined = undefined;

  /**
   * Whether {@link vectorTuningStatements} only applies inside a transaction. `SET LOCAL` does
   * nothing outside one, so the querier - the only layer that knows whether a transaction is open -
   * refuses instead of running a tuning that would silently not apply.
   */
  readonly vectorTuningNeedsTransaction: boolean = false;

  /**
   * `SET`s that widen an ANN index's search for one query, run before it on the same connection.
   *
   * Keyed off `$sort` rather than a `$where` `$near`, because the ANN index is what ranks: pgvector
   * reaches for HNSW on an `ORDER BY distance LIMIT`, while a bare distance predicate scans whatever
   * the planner picks. Tuning a query that never touches the index would set a knob for nothing.
   *
   * Empty by default: SQLite, libSQL and Turso compute every distance, so there is no candidate list
   * to widen, and a field with no ANN index has nothing to tune either.
   */
  vectorTuningStatements<E>(_meta: EntityMeta<E>, _q: Query<E>): readonly string[] {
    return [];
  }

  /** The `$sort` key carrying a vector search, if the query ranks by one. */
  protected vectorSortKey<E>(q: Query<E>): string | undefined {
    return findVectorSort(q.$sort)?.key;
  }

  /**
   * The ANN index `$candidates` would tune for this query, and nothing when there is none to tune -
   * no `$candidates`, no vector ranking, or a field with no ANN index on it. One place, so the two
   * dialects that act on it cannot disagree about when tuning applies.
   *
   * Validates here rather than at each emitter because the number is spelled into the statement
   * rather than bound: `SET LOCAL hnsw.ef_search = $1` is not a thing either engine accepts. `/http`
   * casts client JSON straight to `Query`, so `'abc'` and `null` both reach this.
   */
  protected tunedVectorIndex<E>(meta: EntityMeta<E>, q: Query<E>): EntityIndexMeta | undefined {
    const candidates = q.$candidates;
    if (candidates === undefined) {
      return undefined;
    }
    if (!Number.isInteger(candidates) || candidates < 1) {
      throw new TypeError(`$candidates must be a positive integer, got ${JSON.stringify(candidates)}`);
    }
    const key = this.vectorSortKey(q);
    return key ? findVectorIndex(meta, key) : undefined;
  }

  /**
   * Every distance metric this dialect has, and how it spells each. Empty means no vector search at
   * all, which is what MySQL and D1 are. The key set is the single answer to "is this metric
   * supported here", so a metric cannot be searchable and unindexable or the reverse.
   */
  readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map();

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
   * Whether this engine has pgvector's narrower vector types (`halfvec`, `sparsevec`) or only the one.
   * Declared by the dialect that has them rather than looked up in a table keyed by dialect name.
   */
  protected readonly hasNarrowVectorTypes: boolean = false;

  /**
   * The vector type this dialect actually has for a declared one, so the cast follows the column
   * rather than naming a type the engine does not define.
   */
  supportedVectorType(cast: VectorCast): VectorCast {
    return this.hasNarrowVectorTypes ? cast : 'vector';
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
   * The distance expression, in whichever of the two shapes this dialect spells it. One method for
   * both, so the metric lookup and its refusal exist once rather than per shape.
   */
  protected appendVectorSort<E>(ctx: QueryContext, meta: EntityMeta<E>, key: string, search: QueryVectorSearch): void {
    if (this.vectorMetrics.size === 0) {
      throw new TypeError(
        `${this.dialectName} does not support vector similarity search. Use raw() for vector queries.`,
      );
    }
    const { colName, distance, field } = this.resolveVectorSortParams(meta, key, search);
    const metric = this.vectorMetrics.get(distance);
    if (!metric) {
      throw unsupportedVectorMetric(this.dialectName, distance);
    }
    if ('fn' in metric) {
      ctx.append(`${metric.fn}(${this.escapeId(colName)}, `);
      this.appendVectorValue(ctx, search.$vector, field);
      ctx.append(')');
      return;
    }
    ctx.append(`${this.escapeId(colName)} ${metric.op} `);
    this.appendVectorValue(ctx, search.$vector, field);
  }
}
