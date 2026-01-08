/**
 * Canonical Type System
 *
 * Provides bidirectional mapping between:
 * - SQL types (dialect-specific)
 * - Canonical types (dialect-agnostic)
 * - TypeScript types (for entity generation)
 */

import type { ColumnType, FieldOptions } from '../type/entity.js';
import type { Dialect } from '../type/index.js';
import type { CanonicalType, SizeVariant, TypeCategory } from './types.js';

// ============================================================================
// Type Mapping Tables
// ============================================================================

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

  // === JSON ===
  json: { category: 'json' },
  jsonb: { category: 'json' },

  // === UUID ===
  uuid: { category: 'uuid' },

  // === Binary ===
  blob: { category: 'blob' },
  bytea: { category: 'blob' },
  binary: { category: 'blob' },
  varbinary: { category: 'blob' },
  tinyblob: { category: 'blob', size: 'tiny' },
  mediumblob: { category: 'blob', size: 'medium' },
  longblob: { category: 'blob', size: 'big' },

  // === Vector (for AI/embeddings) ===
  vector: { category: 'vector' },
};

const CANONICAL_TO_SQL: Record<Dialect, Record<TypeCategory, string>> = {
  postgres: {
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
    vector: 'VECTOR',
  },
  mysql: {
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
    vector: 'JSON', // MySQL doesn't have native vector type
  },
  sqlite: {
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
    vector: 'TEXT',
  },
  mariadb: {
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
    vector: 'JSON',
  },
  // MongoDB uses BSON types, not SQL types. These are placeholders for compatibility.
  mongodb: {
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
    vector: 'array',
  },
};

/**
 * Size variant modifiers for SQL types.
 */
const SIZE_MODIFIERS: Record<Dialect, Partial<Record<TypeCategory, Record<SizeVariant, string>>>> = {
  postgres: {
    integer: {
      tiny: 'SMALLINT',
      small: 'SMALLINT',
      medium: 'INTEGER',
      big: 'BIGINT',
    },
    float: {
      tiny: 'REAL',
      small: 'REAL',
      medium: 'DOUBLE PRECISION',
      big: 'DOUBLE PRECISION',
    },
  },
  mysql: {
    integer: {
      tiny: 'TINYINT',
      small: 'SMALLINT',
      medium: 'MEDIUMINT',
      big: 'BIGINT',
    },
    float: {
      tiny: 'FLOAT',
      small: 'FLOAT',
      medium: 'DOUBLE',
      big: 'DOUBLE',
    },
    string: {
      tiny: 'TINYTEXT',
      small: 'TEXT',
      medium: 'MEDIUMTEXT',
      big: 'LONGTEXT',
    },
    blob: {
      tiny: 'TINYBLOB',
      small: 'BLOB',
      medium: 'MEDIUMBLOB',
      big: 'LONGBLOB',
    },
  },
  sqlite: {}, // SQLite uses affinity, no size modifiers
  mariadb: {
    integer: {
      tiny: 'TINYINT',
      small: 'SMALLINT',
      medium: 'MEDIUMINT',
      big: 'BIGINT',
    },
  },
  mongodb: {}, // MongoDB uses BSON types, no size modifiers
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
  blob: 'Buffer',
  vector: 'number[]',
};

// ============================================================================
// Type Conversion Functions
// ============================================================================

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
    category: base.category,
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
    } else if (result.category === 'vector') {
      // VECTOR(1536) -> length (dimensions)
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
 * Convert a canonical type to a SQL type string for a specific dialect.
 */
export function canonicalToSql(type: CanonicalType, dialect: Dialect): string {
  if (type.raw) return type.raw;

  let sqlType = getBaseSqlType(type, dialect);

  if (type.category === 'string') {
    sqlType = formatStringSqlType(type, dialect, sqlType);
  } else if (type.category === 'decimal') {
    sqlType = formatDecimalSqlType(type, dialect, sqlType);
  } else if (type.category === 'vector' && type.length && dialect === 'postgres') {
    sqlType = `VECTOR(${type.length})`;
  }

  if (type.category === 'timestamp' && type.withTimezone && dialect === 'postgres') {
    sqlType = 'TIMESTAMPTZ';
  }

  if (type.unsigned && (dialect === 'mysql' || dialect === 'mariadb')) {
    sqlType = `${sqlType} UNSIGNED`;
  }

  return sqlType;
}

function getBaseSqlType(type: CanonicalType, dialect: Dialect): string {
  let sqlType = CANONICAL_TO_SQL[dialect][type.category];
  if (type.size) {
    const sizeMap = SIZE_MODIFIERS[dialect][type.category];
    if (sizeMap?.[type.size]) {
      sqlType = sizeMap[type.size];
    }
  }
  return sqlType;
}

function formatStringSqlType(type: CanonicalType, dialect: Dialect, baseType: string): string {
  if (dialect === 'sqlite') return 'TEXT';
  if (dialect === 'postgres') return type.length ? `VARCHAR(${type.length})` : 'TEXT';
  if (dialect === 'mysql' || dialect === 'mariadb') {
    if (type.size === 'tiny') return 'TINYTEXT';
    if (type.size === 'small') return 'TEXT';
    if (type.size === 'medium') return 'MEDIUMTEXT';
    if (type.size === 'big') return 'LONGTEXT';
    return type.length ? `VARCHAR(${type.length})` : 'VARCHAR(255)';
  }
  return type.length ? `VARCHAR(${type.length})` : 'VARCHAR(255)';
}

function formatDecimalSqlType(type: CanonicalType, dialect: Dialect, baseType: string): string {
  const p = type.precision ?? (dialect === 'mysql' || dialect === 'mariadb' ? 10 : undefined);
  const s = type.scale ?? (dialect === 'mysql' || dialect === 'mariadb' ? 2 : undefined);
  if (p !== undefined) {
    return s !== undefined ? `${baseType}(${p}, ${s})` : `${baseType}(${p})`;
  }
  return baseType;
}

/**
 * Convert a canonical type to a TypeScript type string.
 */
export function canonicalToTypeScript(type: CanonicalType): string {
  return CANONICAL_TO_TS[type.category];
}

/**
 * Convert UQL FieldOptions to a canonical type.
 */
export function fieldOptionsToCanonical(options: FieldOptions, tsType?: unknown): CanonicalType {
  // If explicit columnType is specified, use it
  if (options.columnType) {
    const base = sqlToCanonical(options.columnType);
    return {
      ...base,
      length: options.length ?? base.length,
      precision: options.precision ?? base.precision,
      scale: options.scale ?? base.scale,
    };
  }

  // Infer from type (could be constructor or string)
  const type = options.type || tsType;

  if (type === String) {
    return {
      category: 'string',
      length: options.length,
    };
  }

  if (type === Number) {
    if (options.precision || options.scale) {
      return {
        category: 'decimal',
        precision: options.precision,
        scale: options.scale,
      };
    }
    // Infer bigint for Number if autoIncrement is true or if it's a primary key
    if (options.autoIncrement || options.isId) {
      return { category: 'integer', size: 'big' };
    }
    return { category: 'integer', size: 'big' };
  }

  if (type === Boolean) {
    return { category: 'boolean' };
  }

  if (type === Date) {
    return { category: 'timestamp' };
  }

  if (type === BigInt) {
    return { category: 'integer', size: 'big' };
  }

  if (typeof type === 'string') {
    return sqlToCanonical(type);
  }

  // Default to string
  return { category: 'string', length: options.length };
}

/**
 * Compare two canonical types for equality.
 * Used for schema diffing.
 */
export function areTypesEqual(a: CanonicalType, b: CanonicalType): boolean {
  // Category must match
  if (a.category !== b.category) {
    return false;
  }

  // Size must match (if specified)
  if (a.size !== b.size) {
    return false;
  }

  // For strings, compare length (allowing for default 255)
  if (a.category === 'string') {
    const lengthA = a.length ?? 255;
    const lengthB = b.length ?? 255;
    if (lengthA !== lengthB) {
      return false;
    }
  }

  // For decimals, compare precision and scale (allowing for default 10, 2)
  if (a.category === 'decimal') {
    const pA = a.precision ?? 10;
    const pB = b.precision ?? 10;
    const sA = a.scale ?? 2;
    const sB = b.scale ?? 2;
    if (pA !== pB || sA !== sB) {
      return false;
    }
  }

  // For timestamps, compare timezone
  if (a.category === 'timestamp') {
    if (!!a.withTimezone !== !!b.withTimezone) {
      return false;
    }
  }

  // Unsigned must match
  if (!!a.unsigned !== !!b.unsigned) {
    return false;
  }

  return true;
}

/**
 * Check if changing from type A to type B could cause data loss.
 */
export function isBreakingTypeChange(from: CanonicalType, to: CanonicalType): boolean {
  // Changing category is always potentially breaking
  if (from.category !== to.category) {
    return true;
  }

  // Reducing size is breaking
  const sizeOrder: SizeVariant[] = ['tiny', 'small', 'medium', 'big'];
  if (from.size && to.size) {
    const fromIndex = sizeOrder.indexOf(from.size);
    const toIndex = sizeOrder.indexOf(to.size);
    if (toIndex < fromIndex) {
      return true;
    }
  }

  // Reducing string length is breaking
  if (from.category === 'string' && from.length && to.length) {
    if (to.length < from.length) {
      return true;
    }
  }

  // Reducing precision/scale is breaking
  if (from.category === 'decimal') {
    if (from.precision && to.precision && to.precision < from.precision) {
      return true;
    }
    if (from.scale && to.scale && to.scale < from.scale) {
      return true;
    }
  }

  return false;
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
    default:
      return 'varchar';
  }
}
