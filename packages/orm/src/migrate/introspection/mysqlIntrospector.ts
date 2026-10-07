import type { IndexFacet } from '../../schema/indexDifferences.js';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { CheckSchema } from '../../schema/types.js';
import type { ForeignKeySchema, IndexSchema, PrimaryKeySchema } from '../../type/index.js';
import { unescapeMysqlString } from '../../util/sqlLiteral.js';
import {
  AbstractSqlSchemaIntrospector,
  type JoinedForeignKeyRow,
  type ReadColumn,
  type TableRowReader,
} from './abstractSqlSchemaIntrospector.js';

/**
 * MySQL/MariaDB schema introspector.
 * Works with both MySQL and MariaDB as they share the same information_schema structure.
 */
export class MysqlSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  // A MySQL "schema" is a database, so the connection's own is what `DATABASE()` reports.
  protected override readonly defaultSchemaExpr = 'DATABASE()';

  protected triggersQuery(): string {
    return /*sql*/ `
      SELECT TRIGGER_NAME AS name,
        CONCAT('CREATE TRIGGER \`', TRIGGER_SCHEMA, '\`.\`', TRIGGER_NAME, '\` ', ACTION_TIMING, ' ', EVENT_MANIPULATION,
          ' ON \`', EVENT_OBJECT_SCHEMA, '\`.\`', EVENT_OBJECT_TABLE, '\` FOR EACH ROW ', ACTION_STATEMENT) AS definition
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ${this.schemaExpr} AND EVENT_OBJECT_TABLE = ${this.dialect.placeholder(1)}
    `;
  }

  /**
   * `CHECK_CONSTRAINTS` names no table on MySQL, where a check's name is unique in its schema, so the
   * table comes from `TABLE_CONSTRAINTS`. It reports the clause escaped as a literal's body (`\'a\'`).
   */
  protected async getChecks(read: TableRowReader, tableName: string): Promise<CheckSchema[]> {
    const rows = await read<{ name: string; expression: string }>(
      /*sql*/ `
      SELECT k.CONSTRAINT_NAME AS name, c.CHECK_CLAUSE AS expression
      FROM information_schema.TABLE_CONSTRAINTS k
      JOIN information_schema.CHECK_CONSTRAINTS c
        ON c.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_TYPE = 'CHECK' AND k.TABLE_SCHEMA = ${this.schemaExpr} AND k.TABLE_NAME = ?
    `,
      [tableName],
    );
    return rows.map(({ name, expression }) => ({ name, expression: unescapeMysqlString(expression) }));
  }

  protected getTableNamesQuery(): string {
    return /*sql*/ `
      SELECT TABLE_NAME as table_name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ${this.schemaExpr}
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;
  }

  protected tableExistsQuery(): string {
    return /*sql*/ `
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ${this.schemaExpr} AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'
    `;
  }

  protected async getColumns(read: TableRowReader, tableName: string): Promise<ReadColumn[]> {
    const rows = await read<MysqlColumnRow>(
      /*sql*/ `
      SELECT
        COLUMN_NAME as column_name,
        DATA_TYPE as data_type,
        COLUMN_TYPE as column_type,
        IS_NULLABLE as is_nullable,
        COLUMN_DEFAULT as column_default,
        CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
        NUMERIC_PRECISION as numeric_precision,
        NUMERIC_SCALE as numeric_scale,
        DATETIME_PRECISION as datetime_precision,
        EXTRA as extra,
        CASE WHEN EXTRA LIKE '%STORED GENERATED%' THEN GENERATION_EXPRESSION END as generated_as,
        COLUMN_COMMENT as column_comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ${this.schemaExpr}
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `,
      [tableName],
    );
    return rows.map((row) => ({
      name: row.column_name,
      type: row.column_type.toUpperCase(),
      nullable: row.is_nullable === 'YES',
      defaultValue: this.parseDefaultValue(row.column_default, row.extra),
      isAutoIncrement: row.extra.toLowerCase().includes('auto_increment'),
      // A `VECTOR`'s is its bytes, four a dimension, which `column_type` already states as dimensions.
      length: /^vector/i.test(row.column_type) ? undefined : this.toNumber(row.character_maximum_length),
      // A timestamp's fractional digits, stated even when 0, which uql's own unstated `DATETIME(3)` is not.
      precision: this.toNumber(TIMESTAMP_TYPES.has(row.data_type) ? row.datetime_precision : row.numeric_precision),
      scale: this.toNumber(row.numeric_scale),
      comment: row.column_comment || undefined,
      generatedAs: row.generated_as ?? undefined,
    }));
  }

  protected async getIndexes(read: TableRowReader, tableName: string): Promise<IndexSchema[]> {
    const rows = await read<MysqlIndexRow>(
      /*sql*/ `
      SELECT
        INDEX_NAME as index_name,
        GROUP_CONCAT(COALESCE(COLUMN_NAME, '') ORDER BY SEQ_IN_INDEX) as columns,
        NOT NON_UNIQUE as is_unique,
        MAX(INDEX_TYPE) as method
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ${this.schemaExpr}
        AND TABLE_NAME = ?
        AND INDEX_NAME != 'PRIMARY'
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY INDEX_NAME
    `,
      [tableName],
    );
    return rows.map((row) => ({
      name: row.index_name,
      ...(row.method === 'VECTOR' && { type: 'vector' as const }),
      // A functional or multi-valued key part has no `COLUMN_NAME` - the `COALESCE` above keeps its
      // place in the list, and it is reported as the expression it is, which is what stops diffing
      // from comparing an entry list the server cannot state against the entity's own.
      entries: row.columns.split(',').map((column) => (column ? { column } : { column, expression: true })),
      unique: Boolean(row.is_unique),
    }));
  }

  protected async getForeignKeys(read: TableRowReader, tableName: string): Promise<ForeignKeySchema[]> {
    const rows = await read<JoinedForeignKeyRow>(
      /*sql*/ `
      SELECT
        kcu.CONSTRAINT_NAME as constraint_name,
        GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) as columns,
        kcu.REFERENCED_TABLE_NAME as referenced_table,
        GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) as referenced_columns,
        rc.DELETE_RULE as delete_rule,
        rc.UPDATE_RULE as update_rule
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE kcu.TABLE_SCHEMA = ${this.schemaExpr}
        AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      GROUP BY kcu.CONSTRAINT_NAME, kcu.REFERENCED_TABLE_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
      ORDER BY kcu.CONSTRAINT_NAME
    `,
      [tableName],
    );
    return this.joinedForeignKeys(rows);
  }

  /** Unnamed: MySQL calls every key `PRIMARY`, and drops one by no name. */
  protected getPrimaryKey(read: TableRowReader, tableName: string): Promise<PrimaryKeySchema | undefined> {
    return this.readPrimaryKey(
      read,
      /*sql*/ `
      SELECT COLUMN_NAME as column_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ${this.schemaExpr}
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `,
      tableName,
    );
  }

  /**
   * MySQL prints a literal default unquoted, except one wrapped as `DEFAULT ('x')`, the form a `TEXT`
   * column takes. That one comes with a charset introducer and every quote and backslash escaped again:
   * `_utf8mb4\'x\'`.
   */
  protected parseDefaultValue(defaultValue: string | null, extra = ''): unknown {
    if (defaultValue === null) {
      return undefined;
    }
    if (defaultValue.toUpperCase() === 'NULL') {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(defaultValue)) {
      return Number(defaultValue);
    }
    const introduced = /^_\w+(\\'.*\\')$/s.exec(defaultValue);
    const sql = introduced ? undefined : this.sqlText(defaultValue, extra);
    if (sql !== undefined) {
      // Any precision here repeats the column's own, which the column type already states.
      return /^CURRENT_TIMESTAMP(?:\(\d?\))?$/i.test(sql)
        ? new SqlExpression('currentTimestamp')
        : this.sqlDefault(sql);
    }
    const literal = introduced ? unescapeMysqlString(introduced[1]) : defaultValue;
    const quoted = /^'(.*)'$/s.exec(literal);
    return quoted ? unescapeMysqlString(quoted[1]) : literal;
  }

  /**
   * A default's SQL, or `undefined` for a literal. MySQL flags a SQL default `DEFAULT_GENERATED` and prints
   * it escaped like a literal, with charset introducers on its strings: `lower(_utf8mb4\'A\')`.
   */
  protected sqlText(defaultValue: string, extra: string): string | undefined {
    return extra.includes('DEFAULT_GENERATED')
      ? unescapeMysqlString(defaultValue).replace(/(?<![\w'])_[a-z0-9]+(?=')/gi, '')
      : undefined;
  }
}

const TIMESTAMP_TYPES = new Set(['datetime', 'timestamp']);

type MysqlColumnRow = {
  column_name: string;
  data_type: string;
  column_type: string;
  is_nullable: string;
  column_default: string | null;
  extra: string;
  character_maximum_length: number | bigint | null;
  numeric_precision: number | bigint | null;
  datetime_precision: number | bigint | null;
  numeric_scale: number | null;
  column_comment: string | null;
  generated_as: string | null;
};

/**
 * MariaDB reads out of the same `information_schema` as MySQL, save for one column type it does not
 * have: `JSON` there is an alias for `LONGTEXT` plus a `json_valid()` check constraint named after
 * the column, and the catalogue reports the column as `longtext`. That check is the only thing
 * telling one from a column somebody really declared `LONGTEXT`, so it is what the type is read back
 * through - without it every JSON column drifts against the entity that declared it ("expected
 * JSON, got LONGTEXT", flagged as data loss) on a table uql created itself.
 */
export class MariadbSchemaIntrospector extends MysqlSchemaIntrospector {
  /**
   * A check's name is unique only in its table on MariaDB, whose `CHECK_CONSTRAINTS` names the table. A
   * JSON column's `json_valid()` is its type, read by {@link getColumns}, so it is left out.
   */
  protected override async getChecks(read: TableRowReader, tableName: string): Promise<CheckSchema[]> {
    return read<{ name: string; expression: string }>(
      /*sql*/ `
      SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS expression
      FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ${this.schemaExpr} AND TABLE_NAME = ?
        AND CHECK_CLAUSE <> CONCAT('json_valid(\`', CONSTRAINT_NAME, '\`)')
    `,
      [tableName],
    );
  }

  /** MariaDB prints a literal quoted, as SQL reads it (`'it''s'`), so an unquoted default is SQL. */
  protected override sqlText(defaultValue: string): string | undefined {
    return defaultValue.startsWith("'") ? undefined : defaultValue;
  }

  /** Whether an index is MariaDB's vector index, and the distance it was built for. */
  protected override readonly indexFacets: ReadonlySet<IndexFacet> = new Set<IndexFacet>(['vector', 'distance']);

  /**
   * A vector index's distance is kept only in the table's own definition, ``VECTOR KEY `ix` (`vec`)
   * `DISTANCE`='cosine'``, and left out there for MariaDB's default, euclidean.
   */
  protected override async getIndexes(read: TableRowReader, tableName: string): Promise<IndexSchema[]> {
    const indexes = await super.getIndexes(read, tableName);
    if (!indexes.some((index) => index.type === 'vector')) {
      return indexes;
    }
    const qualified = [this.schema, tableName]
      .filter((name) => name !== undefined)
      .map((name) => this.dialect.escapeId(name));
    const [row] = await read<{ 'Create Table': string }>(/*sql*/ `SHOW CREATE TABLE ${qualified.join('.')}`);
    const lines = row['Create Table'].split('\n');
    return indexes.map((index) => {
      if (index.type !== 'vector') {
        return index;
      }
      const line = lines.find((it) => it.includes(`VECTOR KEY \`${index.name}\``));
      const metric = line?.match(/`DISTANCE`='(\w+)'/)?.[1] ?? 'euclidean';
      return { ...index, distance: this.dialect.indexedDistance(metric) };
    });
  }

  protected override async getColumns(read: TableRowReader, tableName: string): Promise<ReadColumn[]> {
    const columns = await super.getColumns(read, tableName);
    const checks = await read<{ column_name: string }>(
      /*sql*/ `
      SELECT CONSTRAINT_NAME as column_name
      FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ${this.schemaExpr}
        AND TABLE_NAME = ?
        AND CHECK_CLAUSE = CONCAT('json_valid(\`', CONSTRAINT_NAME, '\`)')
    `,
      [tableName],
    );
    const jsonColumns = new Set(checks.map((row) => row.column_name));
    // The reported `LONGTEXT` length is that type's maximum, which means nothing for a JSON column.
    return columns.map((column) =>
      jsonColumns.has(column.name) ? { ...column, type: 'JSON', length: undefined } : column,
    );
  }
}

type MysqlIndexRow = { index_name: string; columns: string; is_unique: number; method: string };
