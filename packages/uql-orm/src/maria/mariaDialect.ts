import { jsonPath } from '../dialect/jsonSql.js';
import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';
import { isVectorFieldType } from '../dialect/vectorCast.js';
import type {
  DialectFeatures,
  FieldOptions,
  IndexFeature,
  IndexSchema,
  QueryContext,
  Type,
  VectorDistance,
} from '../type/index.js';

export class MariaDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mariadb';

  // MariaDB 10.5+ supports `INSERT ... RETURNING` (see `insert` below), so IDs are exact per row.
  override readonly insertIdSource = 'returning';

  /**
   * MariaDB has no functional indexes: `CREATE INDEX ... ((lower(col)))` is a syntax error even on
   * 12.3, where the documented workaround is a generated column. So it keeps the prefix lengths the
   * family shares and drops expressions.
   */
  protected override readonly indexFeatures = new Set<IndexFeature>(['prefixLength']);

  /** Unlike MySQL: `VECTOR(n)` takes its dimension, and its vector index is declared inline. */
  protected override readonly featureOverrides: Partial<DialectFeatures> = {
    vectorSupportsLength: true,
    inlineVectorIndex: true,
  };

  /** MariaDB 10.5+ supports `INSERT ... RETURNING`, so the ids are exact per row. */
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

  /** MariaDB's own names for the metrics its vector index accepts. */
  private static readonly INLINE_VECTOR_METRICS = new Map<VectorDistance, string>([
    ['cosine', 'cosine'],
    ['l2', 'euclidean'],
  ]);

  /** MariaDB 11.7+ vector distance functions. */
  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map([
    ['cosine', 'VEC_DISTANCE_COSINE'],
    ['l2', 'VEC_DISTANCE_EUCLIDEAN'],
  ]);

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

  /**
   * MariaDB declares a vector index inside `CREATE TABLE`: `VECTOR INDEX (col) M=n DISTANCE=metric`.
   * Its metric names are its own (`euclidean`, not `l2`), and an unsupported one throws rather than
   * being dropped, which would silently build the index on cosine instead.
   */
  override getInlineVectorIndexDeclaration(index: IndexSchema): string {
    const columns = index.columns.map((entry) => this.indexColumnTarget(entry)).join(', ');
    let clause = `VECTOR INDEX (${columns})`;
    if (index.m !== undefined) {
      clause += ` M=${index.m}`;
    }
    if (index.distance) {
      const metric = MariaDialect.INLINE_VECTOR_METRICS.get(index.distance);
      if (!metric) {
        throw new TypeError(
          `${this.dialectName} does not support vector distance metric: ${index.distance} (index "${index.name}")`,
        );
      }
      clause += ` DISTANCE=${metric}`;
    }
    return clause;
  }

  /** The reverse: selecting a `VECTOR` column raw yields that blob, so it is read back as text. */
  protected override selectFieldExpr(escapedColumn: string, field: FieldOptions): string {
    return isVectorFieldType(field.type) ? `VEC_ToText(${escapedColumn})` : escapedColumn;
  }
}
