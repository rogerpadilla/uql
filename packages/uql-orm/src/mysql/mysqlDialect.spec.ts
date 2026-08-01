import { expect } from 'vitest';
import type { JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { MySqlFamilySpec } from '../dialect/mysqlFamilyDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Company, createSpec, User } from '../test/index.js';
import type { QueryConflictPaths, UpdatePayload } from '../type/index.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySqlDialectSpec extends MySqlFamilySpec {
  constructor() {
    super(new MySqlDialect());
  }

  protected override jsonCastText(operand: string): string {
    return `CAST(${operand} AS JSON)`;
  }

  shouldThrowForVectorSort() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, VectorItem, {
          $select: { id: true },
          $sort: { vec: { $vector: [1, 2, 3] } },
          $limit: 10,
        }),
      ),
    ).toThrow('mysql does not support vector similarity sort');
  }

  shouldGetBeginTransactionStatementsWithIsolationLevel() {
    // MySQL uses 'set-before' strategy - two separate statements
    expect(this.dialect.getBeginTransactionStatements('read committed')).toEqual([
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'START TRANSACTION',
    ]);
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual([
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
      'START TRANSACTION',
    ]);
  }

  /**
   * MySQL's `->`/`->>` require a full JSON path, so the whole dotted path goes into one accessor.
   * A bare key (`` `kind`->>'public' ``) is rejected at runtime with "Invalid JSON path expression".
   */
  shouldFilterAndSortByJsonDotNotation() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.public': 1 } }),
    );
    expect(res.sql).toBe("SELECT `id` FROM `Company` WHERE CAST((`kind`->>'$.public') AS DECIMAL) = ?");
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.theme.color': 'red' } }),
    );
    expect(res.sql).toBe("SELECT `id` FROM `Company` WHERE (`kind`->>'$.theme.color') = ?");

    res = this.exec((ctx) => this.dialect.find(ctx, Company, { $select: { id: true }, $sort: { 'kind.public': -1 } }));
    expect(res.sql).toBe("SELECT `id` FROM `Company` ORDER BY (`kind`->>'$.public') DESC");
  }

  /**
   * The comparison mode is decided from *all* operands, so a mixed `$in` cannot depend on element
   * order - it used to read `values[0]`, making `[1, 'a']` and `['a', 1]` emit different SQL.
   */
  shouldNotLetJsonInOperandOrderChangeTheSql() {
    const sqlOf = (values: unknown[]) =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Company, {
          $select: { id: true },
          $where: { 'kind.meta.mixed': { $in: values } },
        }),
      ).sql;
    expect(sqlOf([1, 'a'])).toBe(sqlOf(['a', 1]));
    // All-numeric operands still get the numeric cast.
    expect(sqlOf([1, 2])).toContain('CAST(');
    expect(sqlOf([1, 'a'])).not.toContain('CAST(');
  }

  /** The array operators read the subtree, so they use `->` with the same full path. */
  shouldFilterByJsonDotNotationArrayOperators() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.tags': { $size: 2 } } }),
    );
    expect(res.sql).toBe("SELECT `id` FROM `Company` WHERE JSON_LENGTH(`kind`->'$.tags') = ?");
    expect(res.values).toEqual([2]);
  }

  // ─── JSON update operators ($set / $unset / $push / $pull) ───────────────
  // The MySQL-family SQL for these lives in `MysqlLikeSqlDialect`, so it is asserted here.

  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(COALESCE(`kind`, '{}'), '$.private', CAST(? AS JSON)), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    unsetOnly: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(`kind`, '$.public', '$.private'), `updatedAt` = ? WHERE `id` = ?",
      values: [123, 1],
    },
    setUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', CAST(? AS JSON)), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    push: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(CAST(? AS JSON)))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
    pull: {
      sql: "UPDATE `Company` SET `kind` = JSON_REPLACE(`kind`, '$.tags', (SELECT COALESCE(JSON_ARRAYAGG(_uql_pull.v), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) _uql_pull WHERE _uql_pull.v <> CAST(? AS JSON))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', 123, 1],
    },
    /** Regression: `$push` must append to the pulled array, not to the stored one. */
    pullPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_REPLACE(`kind`, '$.tags', (SELECT COALESCE(JSON_ARRAYAGG(_uql_pull.v), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) _uql_pull WHERE _uql_pull.v <> CAST(? AS JSON))), JSON_OBJECT('tags', JSON_ARRAY(CAST(? AS JSON)))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', '"b"', 123, 1],
    },
    setPushCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', CAST(? AS JSON)), JSON_OBJECT('tags', JSON_ARRAY(CAST(? AS JSON)))), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', '"new-tag"', 123, 1],
    },
    setPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.tags', CAST(? AS JSON)), JSON_OBJECT('tags', JSON_ARRAY(CAST(? AS JSON)))), `updatedAt` = ? WHERE `id` = ?",
      values: ['["a"]', '"b"', 123, 1],
    },
    pushUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(CAST(? AS JSON)))), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
  };

  shouldEscapeSingleQuotesInJsonKeys() {
    const { sql } = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, {
        kind: { $unset: ["it's"] },
        updatedAt: 123,
      } as UpdatePayload<Company>),
    );
    expect(sql).toBe("UPDATE `Company` SET `kind` = JSON_REMOVE(`kind`, '$.it''s'), `updatedAt` = ? WHERE `id` = ?");
  }

  /** Each pull subquery reads the column, so its value binds exactly once, in SQL order. */
  shouldBindTwoJsonPullKeysInOrder() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        { kind: { $pull: { tags: 'a', labels: 'b' } }, updatedAt: 123 },
      ),
    );
    expect(sql).toContain("JSON_REPLACE(JSON_REPLACE(`kind`, '$.tags'");
    expect(values).toEqual(['"a"', '"b"', 123, 1]);
  }

  shouldCombineAllJsonOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { $pull: { tags: 'a' }, $set: { private: 1 }, $push: { tags: 'b' }, $unset: ['public'] },
          updatedAt: 123,
        },
      ),
    );
    // Applied innermost-first: $pull -> $set -> $push -> $unset.
    expect(sql).toContain("JSON_REMOVE(JSON_MERGE_PRESERVE(JSON_SET(COALESCE(JSON_REPLACE(`kind`, '$.tags'");
    expect(values).toEqual(['"a"', '1', '"b"', 123, 1]);
  }
  /**
   * Every non-conflict column is itself a conflict key, so there is nothing to assign and the statement
   * degrades to `INSERT IGNORE`. This was asserted on the base dialect's spec while the base implemented
   * MySQL's syntax; it belongs with the family that speaks it.
   */
  shouldUpsertWithNothingToUpdate() {
    const ctx = this.dialect.createContext();
    const conflictPaths = {
      id: true,
      companyId: true,
      creatorId: true,
      createdAt: true,
      updatedAt: true,
      name: true,
      email: true,
      password: true,
    } as QueryConflictPaths<User>;

    this.dialect.upsert(ctx, User, conflictPaths, { name: 'John' });

    expect(ctx.sql).toContain('INSERT IGNORE');
  }
}

createSpec(new MySqlDialectSpec());
