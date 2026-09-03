import { jsonPath } from '../dialect/jsonSql.js';
import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';
import { isVectorFieldType } from '../dialect/vectorCast.js';
import type { DialectFeatures, FieldOptions, QueryContext, Type, VectorDistance } from '../type/index.js';
import { MARIA_VECTOR_METRICS } from './mariaVectorMetrics.js';

export class MariaDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mariadb';

  // MariaDB 10.5+ has `INSERT ... RETURNING`, so ids come back exact per row - the upsert's too.
  override readonly insertIdSource = 'returning';

  /** MariaDB has no `FOR ... OF`, so a lock cannot be narrowed to one table of a join. */
  override readonly supportsLockOf = false;

  /**
   * Unlike MySQL: `VECTOR(n)` takes its dimension, every column of a vector index has to be NOT NULL,
   * and `CREATE INDEX` takes `IF NOT EXISTS` - which MySQL's grammar has no place for.
   */
  protected override readonly featureOverrides: Partial<DialectFeatures> = {
    vectorSupportsLength: true,
    vectorIndexRequiresNotNull: true,
    indexIfNotExists: true,
  };

  protected override upsertReturning<E>(entity: Type<E>): string {
    return ` ${this.returningId(entity)}`;
  }

  /**
   * MariaDB supports neither MySQL's `->`/`->>` shorthand nor the base's chained form. `JSON_VALUE`
   * reads a scalar and `JSON_EXTRACT` the subtree that the array operators need.
   */
  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPathStr: string): string {
    return `JSON_VALUE(${escapedColumn}, ${jsonPath(jsonPathStr)})`;
  }

  protected override getJsonPathJsonbExpr(escapedColumn: string, jsonPathStr: string): string {
    return `JSON_EXTRACT(${escapedColumn}, ${jsonPath(jsonPathStr)})`;
  }

  /** MariaDB has no `CAST(val AS JSON)`; `JSON_EXTRACT` at the root reads a value as JSON. */
  protected override jsonCast(operand: string): string {
    return `JSON_EXTRACT(${operand}, '$')`;
  }

  /**
   * MariaDB stores JSON as text, so JSON_ARRAYAGG would re-quote each element into a string
   * (`["\"a\""]`). JSON_COMPACT marks it back as JSON, keeping element types intact.
   */
  protected override jsonPullElem(alias: string): string {
    return `JSON_COMPACT(${alias}.v)`;
  }

  /** Text-backed JSON compares as text, so use JSON_EQUALS for key-order-independent equality. */
  protected override jsonPullKeep(alias: string, operand: string): string {
    return `NOT JSON_EQUALS(${alias}.v, ${operand})`;
  }

  /** `VEC_DISTANCE_COSINE`/`VEC_DISTANCE_EUCLIDEAN`, 11.7+: the metric's own name, uppercased. */
  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map(
    [...MARIA_VECTOR_METRICS].map(([metric, name]) => [metric, `VEC_DISTANCE_${name.toUpperCase()}`]),
  );

  /**
   * A `VECTOR` column holds a packed little-endian float32 blob, and MariaDB refuses text where one
   * belongs: inserting `'[1,2,3]'` fails with `Incorrect vector value`, and passing it to
   * `VEC_DISTANCE_COSINE` with `Illegal parameter data type varchar`. `VEC_FromText` is the
   * conversion, needed on both paths.
   */
  protected override appendVectorValue(ctx: QueryContext, value: readonly unknown[]): void {
    ctx.append('VEC_FromText(');
    super.appendVectorValue(ctx, value);
    ctx.append(')');
  }

  /** The reverse: selecting a `VECTOR` column raw yields that blob, so it is read back as text. */
  protected override selectFieldExpr(escapedColumn: string, field: FieldOptions): string {
    return isVectorFieldType(field.type) ? `VEC_ToText(${escapedColumn})` : escapedColumn;
  }
}
