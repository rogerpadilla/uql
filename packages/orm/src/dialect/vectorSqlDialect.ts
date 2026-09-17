import type {
  EntityIndexMeta,
  EntityMeta,
  FieldKey,
  FieldOptions,
  Query,
  QueryContext,
  QueryVectorSearch,
  SqlDialectFeatures,
  VectorDistance,
  VectorMetric,
} from '../type/index.js';
import { unsupportedVectorMetric } from '../type/vector.js';
import { findVectorIndex, findVectorSort } from '../util/dialect.util.js';
import { entityName } from '../util/object.util.js';
import { AbstractDialect } from './abstractDialect.js';
import type { VectorCast } from './vectorCast.js';

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
   * Every distance metric this dialect has, and how a search and an index spell each. Empty means no
   * vector search at all, which is what MySQL and D1 are. The key set is the single answer to "is this
   * metric supported here", for a query and an index alike.
   */
  readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map();

  /** Quotes an identifier; supplied by the SQL dialect built on top of this layer. */
  abstract escapeId(val: string | undefined, forbidQualified?: boolean, addDot?: boolean): string;

  /**
   * What a distance expression reads, for a `$sort` and a `$near` alike. The metric falls back to the
   * field's, then its index's, which serves no other, then cosine.
   */
  protected resolveVectorDistance<E>(
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): { colName: string; distance: VectorDistance; field: FieldOptions | undefined } {
    const field = meta.fields[key as FieldKey<E>];
    const colName = this.resolveColumnName(key, field);
    const distance = search.$distance ?? field?.distance ?? findVectorIndex(meta, key)?.distance ?? 'cosine';
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
   * rather than naming a type the engine does not define.
   */
  supportedVectorType(cast: VectorCast): VectorCast {
    return this.features.narrowVectorTypes ? cast : 'vector';
  }

  /**
   * The distance a vector `$sort` projects, which the projection names after `$project`. Delegates to
   * `appendVectorDistance` so each dialect's distance syntax is written once.
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
    this.appendVectorDistance(ctx, meta, key, search);
  }

  /**
   * The distance expression, in whichever of the two shapes this dialect spells it. One method for
   * both, so the metric lookup and its refusal exist once rather than per shape.
   */
  protected appendVectorDistance<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): void {
    if (this.vectorMetrics.size === 0) {
      throw new TypeError(
        `${this.dialectName} does not support vector similarity search. Use raw() for vector queries.`,
      );
    }
    const { colName, distance, field } = this.resolveVectorDistance(meta, key, search);
    const metric = this.vectorMetrics.get(distance);
    if (!metric) {
      throw unsupportedVectorMetric(this.dialectName, distance);
    }
    if ('fn' in metric) {
      const leading = metric.metricArg === undefined ? '' : `'${metric.metricArg}', `;
      ctx.append(`${metric.fn}(${leading}${this.escapeId(colName)}, `);
      this.appendVectorValue(ctx, search.$vector, field);
      ctx.append(')');
      return;
    }
    ctx.append(`${this.escapeId(colName)} ${metric.op} `);
    this.appendVectorValue(ctx, search.$vector, field);
  }
}
