import type {
  EntityIndexMeta,
  EntityMeta,
  FieldKey,
  FieldOptions,
  Query,
  QueryContext,
  QueryVectorQuery,
  QueryWhere,
  SqlDialectFeatures,
  VectorDistance,
  VectorMetric,
} from '../type/index.js';
import { unsupportedVectorMetric } from '../type/vector.js';
import { findVectorIndex, findVectorSort, vectorCandidates, vectorDistanceOf } from '../util/dialect.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { AbstractDialect } from './abstractDialect.js';
import { encodeFloat32s, type VectorCast } from './vectorCast.js';

/**
 * Vector search for the SQL dialects: the distance a `$sort` ranks by and projects, and the ANN tuning.
 * Each dialect lists its metrics in {@link vectorMetrics}, an operator or a function; empty means no search.
 */
export abstract class VectorSqlDialect extends AbstractDialect {
  readonly vectorExtension: string | undefined = undefined;

  abstract override readonly features: SqlDialectFeatures;

  /**
   * `SET`s widening an ANN index's search for one query, run before it on its connection. Keyed off `$sort`,
   * since the index is what ranks. Empty where every distance is computed anyway.
   */
  vectorTuningStatements<E>(_meta: EntityMeta<E>, _q: Query<E>): readonly string[] {
    return [];
  }

  /** The `$sort` key carrying a vector search, if the query ranks by one. */
  protected vectorSortKey<E>(q: Query<E>): string | undefined {
    return findVectorSort(q.$sort)?.key;
  }

  /**
   * The ANN index `$candidates` tunes for the query, or nothing to tune. Checked here, since the number is
   * spelled into a `SET` rather than bound, and `/http` input is untyped.
   */
  protected tunedVectorIndex<E>(meta: EntityMeta<E>, q: Query<E>): EntityIndexMeta | undefined {
    if (vectorCandidates(q) === undefined) {
      return undefined;
    }
    const key = this.vectorSortKey(q);
    return key ? findVectorIndex(meta, key) : undefined;
  }

  /** The `$where` a read runs: the query's own, which an engine reading its vector index as a table narrows. */
  protected rankedWhere<E>(_meta: EntityMeta<E>, q: Query<E>, _prefix: string | undefined): QueryWhere<E> | undefined {
    return q.$where;
  }

  /**
   * Every distance metric this dialect has, and how a search and an index spell each. Empty means no
   * vector search at all, which is what MySQL and D1 are. The key set is the single answer to "is this
   * metric supported here", for a query and an index alike.
   */
  readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map();

  /** Whether this engine has a vector index: the one a metric's `index` names. */
  hasVectorIndex(): boolean {
    return [...this.vectorMetrics.values()].some((metric) => metric.index);
  }

  /** Quotes an identifier; supplied by the SQL dialect built on top of this layer. */
  abstract escapeId(val: string | undefined, forbidQualified?: boolean, addDot?: boolean): string;

  /** What a distance expression reads, for a `$sort` and a `$near` alike. */
  protected resolveVectorDistance<E>(
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorQuery,
  ): { colName: string; distance: VectorDistance; field: FieldOptions | undefined } {
    const field = meta.fields[key as FieldKey<E>];
    return { colName: this.resolveColumnName(key, field), distance: vectorDistanceOf(meta, key, search), field };
  }

  /**
   * Binds a vector, both as a persisted value and as the query vector of a distance expression, so a
   * dialect needing a conversion around it (`$1::vector`, `CAST(? AS VECTOR(n))`) declares it once.
   */
  protected appendVectorValue(ctx: QueryContext, value: readonly unknown[], _field?: FieldOptions): void {
    ctx.addValue(this.features.vectorBytes ? encodeFloat32s(value) : `[${value.join(',')}]`);
  }

  /**
   * The vector type this dialect actually has for a declared one, so the cast follows the column
   * rather than naming a type the engine does not define.
   */
  supportedVectorType(cast: VectorCast): VectorCast {
    return this.features.narrowVectorTypes ? cast : 'vector';
  }

  /**
   * The distance expression, in whichever of the two shapes this dialect spells it. One method for
   * both, so the metric lookup and its refusal exist once rather than per shape. The column is read
   * under `prefix`, the alias in scope, since a joined table may have a column of the same name.
   */
  protected appendVectorDistance<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorQuery,
    prefix: string | undefined,
  ): void {
    if (this.vectorMetrics.size === 0) {
      throw new UqlUsageError(
        `${this.dialectName} does not support vector similarity search. Use raw() for vector queries.`,
      );
    }
    const { colName, distance, field } = this.resolveVectorDistance(meta, key, search);
    const metric = this.vectorMetrics.get(distance);
    if (!metric) {
      throw unsupportedVectorMetric(this.dialectName, distance);
    }
    const column = this.escapeId(prefix, true, true) + this.escapeId(colName);
    if ('fn' in metric) {
      const leading = metric.metricArg === undefined ? '' : `'${metric.metricArg}', `;
      ctx.append(`${metric.fn}(${leading}${column}, `);
      this.appendVectorValue(ctx, search.$vector, field);
      ctx.append(')');
      return;
    }
    ctx.append(`${column} ${metric.op} `);
    this.appendVectorValue(ctx, search.$vector, field);
  }
}
