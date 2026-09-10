/**
 * Canonical Type System
 *
 * Provides bidirectional mapping between:
 * - SQL types (dialect-specific)
 * - Canonical types (dialect-agnostic)
 * - TypeScript types (for entity generation)
 */

import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type { VectorCast } from '../dialect/vectorCast.js';
import type { ColumnType, FieldOptions } from '../type/entity.js';
import type { DialectFeatures, DialectName } from '../type/index.js';
import { columnFamily } from '../util/field.util.js';
import type { CanonicalType, SizeVariant, TypeCategory } from './types.js';

/** Whether a category is one of the vector types, narrowing it to the cast pgvector names use. */
export function isVectorCategory(category: TypeCategory | undefined): category is VectorCast {
  return category === 'vector' || category === 'halfvec' || category === 'sparsevec';
}

/**
 * Maps SQL type strings to canonical type categories.
 * Handles variations across dialects (PostgreSQL, MySQL, SQLite).
 */
const SQL_TO_CANONICAL: Record<string, Partial<CanonicalType>> = {
  // === Integers ===
  int: { category: 'integer' },
  int4: { category: 'integer' },
  integer: { category: 'integer' },
  tinyint: { category: 'integer', size: 'tiny' },
  smallint: { category: 'integer', size: 'small' },
  int2: { category: 'integer', size: 'small' },
  mediumint: { category: 'integer', size: 'medium' },
  bigint: { category: 'integer', size: 'big' },
  int8: { category: 'integer', size: 'big' },
  serial: { category: 'integer' },
  bigserial: { category: 'integer', size: 'big' },
  smallserial: { category: 'integer', size: 'small' },

  // === Floats ===
  float: { category: 'float' },
  float4: { category: 'float' },
  real: { category: 'float' },
  float8: { category: 'float', size: 'big' },
  double: { category: 'float', size: 'big' },
  'double precision': { category: 'float', size: 'big' },

  // === Decimals ===
  decimal: { category: 'decimal' },
  numeric: { category: 'decimal' },
  money: { category: 'decimal' },

  // === Strings ===
  char: { category: 'string' },
  character: { category: 'string' },
  varchar: { category: 'string' },
  varchar2: { category: 'string' },
  nvarchar: { category: 'string' },
  nchar: { category: 'string' },
  'character varying': { category: 'string' },
  text: { category: 'string', size: 'small' },
  tinytext: { category: 'string', size: 'tiny' },
  mediumtext: { category: 'string', size: 'medium' },
  longtext: { category: 'string', size: 'big' },

  // === Boolean ===
  bool: { category: 'boolean' },
  boolean: { category: 'boolean' },
  bit: { category: 'boolean' },

  // === Date/Time ===
  date: { category: 'date' },
  time: { category: 'time' },
  'time without time zone': { category: 'time' },
  'time with time zone': { category: 'time', withTimezone: true },
  timetz: { category: 'time', withTimezone: true },
  timestamp: { category: 'timestamp' },
  'timestamp without time zone': { category: 'timestamp' },
  'timestamp with time zone': { category: 'timestamp', withTimezone: true },
  timestamptz: { category: 'timestamp', withTimezone: true },
  datetime: { category: 'timestamp' },
  datetime2: { category: 'timestamp' },
  smalldatetime: { category: 'timestamp' },
  datetimeoffset: { category: 'timestamp', withTimezone: true },

  // === JSON ===
  json: { category: 'json' },
  jsonb: { category: 'json' },

  // === UUID ===
  uuid: { category: 'uuid' },
  uniqueidentifier: { category: 'uuid' },

  // === Binary ===
  blob: { category: 'blob' },
  bytea: { category: 'blob' },
  binary: { category: 'blob' },
  varbinary: { category: 'blob' },
  tinyblob: { category: 'blob', size: 'tiny' },
  mediumblob: { category: 'blob', size: 'medium' },
  longblob: { category: 'blob', size: 'big' },
  image: { category: 'blob', size: 'big' },

  // === Vector (for AI/embeddings) ===
  vector: { category: 'vector' },
  halfvec: { category: 'halfvec' },
  sparsevec: { category: 'sparsevec' },
};

/** The scalar half of an engine's type map; the vector categories are added per engine below. */
type ScalarTypeMap = Record<Exclude<TypeCategory, VectorCast>, string>;

/**
 * How one engine spells the canonical types: the base name per category, the variants a `size` picks
 * instead, and the precision a `decimal` falls back to where the engine insists on one.
 *
 * One table per engine rather than one table per question, so every answer for an engine is stated
 * once and in one place.
 */
type EngineTypes = {
  readonly scalars: Record<TypeCategory, string>;
  readonly sizes?: Partial<Record<TypeCategory, Record<SizeVariant, string>>>;
  readonly decimal?: { readonly precision: number; readonly scale: number };
};

/**
 * pgvector is the only engine with three vector column types, so every other engine maps all three
 * canonical categories onto the single type it does have (see `hasNarrowVectorTypes` on the dialect,
 * the dialect-side half of the same fact).
 */
function withVectorType(scalars: ScalarTypeMap, vector: string): Record<TypeCategory, string> {
  return { ...scalars, vector, halfvec: vector, sparsevec: vector };
}

const PG_SCALAR_MAP: ScalarTypeMap = {
  integer: 'INTEGER',
  float: 'REAL',
  decimal: 'NUMERIC',
  string: 'VARCHAR',
  boolean: 'BOOLEAN',
  date: 'DATE',
  time: 'TIME',
  timestamp: 'TIMESTAMP',
  json: 'JSONB',
  uuid: 'UUID',
  blob: 'BYTEA',
};

const PG_SIZES: EngineTypes['sizes'] = {
  integer: { tiny: 'SMALLINT', small: 'SMALLINT', medium: 'INTEGER', big: 'BIGINT' },
  float: { tiny: 'REAL', small: 'REAL', medium: 'DOUBLE PRECISION', big: 'DOUBLE PRECISION' },
};

const MYSQL_SCALAR_MAP: ScalarTypeMap = {
  integer: 'INT',
  float: 'FLOAT',
  decimal: 'DECIMAL',
  string: 'VARCHAR',
  boolean: 'TINYINT(1)',
  date: 'DATE',
  time: 'TIME',
  timestamp: 'DATETIME',
  json: 'JSON',
  uuid: 'CHAR(36)',
  blob: 'BLOB',
};

/** MariaDB is a MySQL fork and spells every one of these the same way, so both take the one map. */
const MYSQL_SIZES: EngineTypes['sizes'] = {
  integer: { tiny: 'TINYINT', small: 'SMALLINT', medium: 'MEDIUMINT', big: 'BIGINT' },
  float: { tiny: 'FLOAT', small: 'FLOAT', medium: 'DOUBLE', big: 'DOUBLE' },
  string: { tiny: 'TINYTEXT', small: 'TEXT', medium: 'MEDIUMTEXT', big: 'LONGTEXT' },
  blob: { tiny: 'TINYBLOB', small: 'BLOB', medium: 'MEDIUMBLOB', big: 'LONGBLOB' },
};

const SQLITE_SCALAR_MAP: ScalarTypeMap = {
  integer: 'INTEGER',
  float: 'REAL',
  decimal: 'REAL',
  string: 'TEXT',
  boolean: 'INTEGER',
  date: 'TEXT',
  time: 'TEXT',
  timestamp: 'TEXT',
  json: 'TEXT',
  uuid: 'TEXT',
  blob: 'BLOB',
};

/**
 * Every string column is `NVARCHAR`: `VARCHAR` is a codepage type on SQL Server and silently destroys
 * anything outside it on write. UQL never exposes the choice, so there is nothing to weigh per column.
 */
const MSSQL_SCALAR_MAP: ScalarTypeMap = {
  integer: 'INT',
  float: 'REAL',
  decimal: 'DECIMAL',
  string: 'NVARCHAR',
  boolean: 'BIT',
  date: 'DATE',
  time: 'TIME',
  timestamp: 'DATETIME2',
  json: 'NVARCHAR(MAX)',
  uuid: 'UNIQUEIDENTIFIER',
  blob: 'VARBINARY(MAX)',
};

/** `FLOAT` is eight bytes here and `REAL` four - the opposite of the MySQL family's spelling. */
const MSSQL_SIZES: EngineTypes['sizes'] = {
  integer: { tiny: 'TINYINT', small: 'SMALLINT', medium: 'INT', big: 'BIGINT' },
  float: { tiny: 'REAL', small: 'REAL', medium: 'FLOAT', big: 'FLOAT' },
  string: { tiny: 'NVARCHAR(255)', small: 'NVARCHAR(MAX)', medium: 'NVARCHAR(MAX)', big: 'NVARCHAR(MAX)' },
  blob: {
    tiny: 'VARBINARY(255)',
    small: 'VARBINARY(MAX)',
    medium: 'VARBINARY(MAX)',
    big: 'VARBINARY(MAX)',
  },
};

/** MongoDB uses BSON types, not SQL types. These are placeholders for compatibility. */
const MONGO_SCALAR_MAP: ScalarTypeMap = {
  integer: 'int',
  float: 'double',
  decimal: 'decimal128',
  string: 'string',
  boolean: 'bool',
  date: 'date',
  time: 'string',
  timestamp: 'timestamp',
  json: 'object',
  uuid: 'binData',
  blob: 'binData',
};

/** Every engine's spelling of the canonical types. A new engine is one entry here and nothing else. */
const ENGINE_TYPES: Record<DialectName, EngineTypes> = {
  postgres: {
    scalars: { ...PG_SCALAR_MAP, vector: 'VECTOR', halfvec: 'HALFVEC', sparsevec: 'SPARSEVEC' },
    sizes: PG_SIZES,
  },
  // CockroachDB's VECTOR is native, no extension needed.
  cockroachdb: { scalars: withVectorType(PG_SCALAR_MAP, 'VECTOR'), sizes: PG_SIZES },
  // MySQL does have a `VECTOR` type (26.7), but no distance function outside HeatWave and no vector
  // index, so JSON keeps the column queryable with the JSON operators and needs no conversion.
  mysql: {
    scalars: withVectorType(MYSQL_SCALAR_MAP, 'JSON'),
    sizes: MYSQL_SIZES,
    decimal: { precision: 10, scale: 2 },
  },
  mariadb: {
    scalars: withVectorType(MYSQL_SCALAR_MAP, 'VECTOR'),
    sizes: MYSQL_SIZES,
    decimal: { precision: 10, scale: 2 },
  },
  // SQLite uses affinity, so no size variants.
  sqlite: { scalars: withVectorType(SQLITE_SCALAR_MAP, 'TEXT') },
  // A 2025 server has a native `VECTOR`; below that the column is JSON text, which stays queryable.
  mssql: { scalars: withVectorType(MSSQL_SCALAR_MAP, 'NVARCHAR(MAX)'), sizes: MSSQL_SIZES },
  mongodb: { scalars: withVectorType(MONGO_SCALAR_MAP, 'array') },
};

/**
 * Maps canonical types to TypeScript types for entity generation.
 */
const CANONICAL_TO_TS: Record<TypeCategory, string> = {
  integer: 'number',
  float: 'number',
  decimal: 'number',
  string: 'string',
  boolean: 'boolean',
  date: 'Date',
  time: 'string',
  timestamp: 'Date',
  json: 'unknown',
  uuid: 'string',
  blob: 'Uint8Array',
  vector: 'number[]',
  halfvec: 'number[]',
  sparsevec: 'number[]',
};

/**
 * Parse a SQL type string into a canonical type.
 * Handles complex types like VARCHAR(255), DECIMAL(10,2), etc.
 */
export function sqlToCanonical(sqlType: string): CanonicalType {
  const normalized = sqlType.toLowerCase().trim();

  // Check for UNSIGNED modifier before extracting base type
  const hasUnsigned = normalized.includes('unsigned');
  const withoutUnsigned = normalized.replace(/\s*unsigned\s*/i, ' ').trim();

  // Extract base type and parameters: "VARCHAR(255)" -> ["varchar", "255"]
  const match = withoutUnsigned.match(/^([a-z][a-z0-9 ]*?)(?:\(([^)]+)\))?$/);
  if (!match) {
    return { category: 'string', raw: sqlType };
  }

  const [, baseType, params] = match;
  const base = SQL_TO_CANONICAL[baseType];

  if (!base) {
    // Unknown type - pass through as raw
    return { category: 'string', raw: sqlType };
  }

  const result: CanonicalType = {
    category: base.category!,
    size: base.size,
    withTimezone: base.withTimezone,
  };

  // Parse parameters
  if (params) {
    const paramParts = params.split(',').map((p) => p.trim());

    if (result.category === 'string' || result.category === 'blob') {
      // VARCHAR(255) -> length
      const length = Number.parseInt(paramParts[0], 10);
      if (!Number.isNaN(length)) {
        (result as { length: number }).length = length;
      }
    } else if (result.category === 'decimal') {
      // DECIMAL(10,2) -> precision, scale
      const precision = Number.parseInt(paramParts[0], 10);
      const scale = paramParts[1] ? Number.parseInt(paramParts[1], 10) : undefined;
      if (!Number.isNaN(precision)) {
        (result as { precision: number }).precision = precision;
      }
      if (scale !== undefined && !Number.isNaN(scale)) {
        (result as { scale: number }).scale = scale;
      }
    } else if (isVectorCategory(result.category)) {
      // VECTOR(1536), HALFVEC(1536), SPARSEVEC(4000) -> length (dimensions)
      const dimensions = Number.parseInt(paramParts[0], 10);
      if (!Number.isNaN(dimensions)) {
        (result as { length: number }).length = dimensions;
      }
    }
  }

  // Check for UNSIGNED modifier
  if (hasUnsigned) {
    (result as { unsigned: boolean }).unsigned = true;
  }

  return result;
}

/**
 * The canonical type for a column an engine reported, merging the metadata columns it reports beside
 * the type name (`character_maximum_length` and friends) over whatever the name itself carried. This is
 * the one place a SQL type string is parsed: everything downstream compares and renders canonical
 * types, so no consumer has to know that `TINYINT(1)` means boolean on MySQL.
 */
export function canonicalColumnType(
  sqlType: string,
  reported: { length?: number; precision?: number; scale?: number } = {},
): CanonicalType {
  const base = sqlToCanonical(sqlType);
  return {
    ...base,
    length: reported.length ?? base.length,
    precision: reported.precision ?? base.precision,
    scale: reported.scale ?? base.scale,
  };
}

/**
 * Convert a canonical type to a SQL type string for a specific dialect instance.
 */
export function canonicalToSql(type: CanonicalType, dialect: AbstractDialect): string {
  if (type.raw) return type.raw;

  const engine = ENGINE_TYPES[dialect.dialectName];
  const { features } = dialect;
  // A `size` the engine spells out wins outright; anything else falls through to the rules below.
  // `TEXT` canonicalizes to `size: 'small'`, so a string counts as unsized only where the engine
  // declares no variant for it, which is how Postgres reaches `TEXT` rather than its base `VARCHAR`.
  const sized = engine.sizes?.[type.category]?.[type.size!];
  let sqlType = sized ?? engine.scalars[type.category];

  if (type.category === 'string' && !sized) {
    sqlType = formatStringSqlType(type, engine.scalars.string, features.stringSizing);
  } else if (type.category === 'decimal') {
    sqlType = formatDecimalSqlType(type, engine.decimal, sqlType);
  } else if (isVectorCategory(type.category) && type.length && features.vectorSupportsLength) {
    sqlType = `${sqlType}(${type.length})`;
  }

  if (type.category === 'timestamp' && type.withTimezone && features.supportsTimestamptz) {
    sqlType = 'TIMESTAMPTZ';
  }

  return type.unsigned && features.supportsUnsigned ? `${sqlType} UNSIGNED` : sqlType;
}

/** See {@link EngineFeatures.stringSizing} for what each mode means. */
function formatStringSqlType(type: CanonicalType, base: string, sizing: DialectFeatures['stringSizing']): string {
  if (sizing === 'text') {
    return base;
  }
  if (type.length) {
    return `${base}(${type.length})`;
  }
  return sizing === 'bounded-text' ? 'TEXT' : `${base}(255)`;
}

function formatDecimalSqlType(type: CanonicalType, fallback: EngineTypes['decimal'], baseType: string): string {
  const p = type.precision ?? fallback?.precision;
  const s = type.scale ?? fallback?.scale;
  if (p === undefined) {
    return baseType;
  }
  return s === undefined ? `${baseType}(${p})` : `${baseType}(${p}, ${s})`;
}

/**
 * Convert a canonical type to a TypeScript type string.
 */
export function canonicalToTypeScript(type: CanonicalType): string {
  return CANONICAL_TO_TS[type.category];
}

/**
 * A type as `dialect` would actually store it: rendered to that engine's SQL and read back.
 *
 * Several canonical types share one storage type per engine - a `boolean` is `TINYINT(1)` on MySQL and
 * `INTEGER` on SQLite - and only the engine settles an unstated bound, since `VARCHAR` is 255 on MySQL
 * and `TEXT` on Postgres. Both paths that diff a schema compare through this, so a migration and a
 * drift report cannot disagree about what changed.
 */
export function engineType(dialect: AbstractDialect): (type: CanonicalType) => CanonicalType {
  return (type) => sqlToCanonical(canonicalToSql(type, dialect));
}

/**
 * Convert UQL FieldOptions to a canonical type.
 */
export function fieldOptionsToCanonical(options: FieldOptions): CanonicalType {
  // An explicit column type is read exactly as an introspected one is: the SQL type, plus whatever
  // bounds are stated beside it.
  if (options.columnType) {
    return canonicalColumnType(options.columnType, options);
  }

  // Infer from type, which is a SQL type string or one of the constructors.
  const { type } = options;

  if (typeof type === 'string') {
    const canonical = sqlToCanonical(type);
    // Propagate explicit dimensions into CanonicalType.length for vector types
    return options.dimensions && isVectorCategory(canonical.category)
      ? { ...canonical, length: options.dimensions }
      : canonical;
  }

  switch (columnFamily(type)) {
    case 'numeric':
      // BIGINT for every `Number` without a scale, key or not: a 32-bit column is a migration waiting
      // to happen, and the pools decode it back to a JS number at the wire (see `pgNumericTypes`).
      return type === Number && (options.precision || options.scale)
        ? { category: 'decimal', precision: options.precision, scale: options.scale }
        : { category: 'integer', size: 'big' };
    case 'boolean':
      return { category: 'boolean' };
    case 'date':
      return { category: 'timestamp' };
    // `String`, and anything a reflected type left unrecognised.
    default:
      return { category: 'string', length: options.length };
  }
}

/**
 * Compare two canonical types for equality. Used for schema diffing.
 *
 * Nothing here guesses an engine's own default for an unstated bound: `VARCHAR` is 255 on MySQL and
 * `TEXT` on Postgres, and a comparison that assumed either was blind to that difference on the other.
 * `DiffOptions.normalizeType` is what settles it, by putting both sides through the engine first.
 */
export function areTypesEqual(a: CanonicalType, b: CanonicalType): boolean {
  return (
    a.category === b.category &&
    a.size === b.size &&
    a.length === b.length &&
    a.precision === b.precision &&
    a.scale === b.scale &&
    !!a.withTimezone === !!b.withTimezone &&
    !!a.unsigned === !!b.unsigned
  );
}

/**
 * Whether changing a column from one type to the other can lose what it holds.
 *
 * An unstated bound is the engine's widest, so stating one for the first time narrows the column just
 * as lowering one does: `TEXT` to `VARCHAR(50)` truncates, and `NUMERIC` to `NUMERIC(5,2)` rounds.
 */
export function isBreakingTypeChange(from: CanonicalType, to: CanonicalType): boolean {
  if (from.category !== to.category) {
    return true;
  }
  // Only where both state a size: an unsized member of a family is the engine's base type, wider than
  // `tiny` and narrower than `big`, and which of those it is depends on a family this does not know.
  if (from.size && to.size && SIZE_ORDER.indexOf(to.size) < SIZE_ORDER.indexOf(from.size)) {
    return true;
  }
  return (
    narrows(from.length, to.length) ||
    narrows(from.precision, to.precision) ||
    narrows(from.scale, to.scale) ||
    // Either direction drops half the range: signed loses the top bit, unsigned the negatives.
    !!from.unsigned !== !!to.unsigned ||
    // An offset the column stops keeping cannot be recovered from what is left.
    (!!from.withTimezone && !to.withTimezone)
  );
}

const SIZE_ORDER: readonly SizeVariant[] = ['tiny', 'small', 'medium', 'big'];

/** A bound narrowed, where an unstated one is unbounded. */
function narrows(from: number | undefined, to: number | undefined): boolean {
  return to !== undefined && (from === undefined || to < from);
}

/**
 * Get the UQL ColumnType that best matches a canonical type.
 */
export function canonicalToColumnType(type: CanonicalType): ColumnType {
  switch (type.category) {
    case 'integer':
      if (type.size === 'big') return 'bigint';
      if (type.size === 'small') return 'smallint';
      return 'int';
    case 'float':
      if (type.size === 'big') return 'double';
      return 'float';
    case 'decimal':
      return 'decimal';
    case 'string':
      if (!type.length || type.length > 10000) return 'text';
      return 'varchar';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'timestamp':
      return type.withTimezone ? 'timestamptz' : 'timestamp';
    case 'json':
      return 'jsonb';
    case 'uuid':
      return 'uuid';
    case 'blob':
      return 'bytea';
    case 'vector':
      return 'vector';
    case 'halfvec':
      return 'halfvec';
    case 'sparsevec':
      return 'sparsevec';
    default:
      return 'varchar';
  }
}
