import { expect } from 'vitest';
import type { JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { MySqlFamilySpec } from '../dialect/mysqlFamilyDialect-spec.js';
import { Company, ItemTag, VectorItem } from '../test/index.js';
import { createSpec } from '../test/spec.util.js';
import type { Type } from '../type/index.js';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends MySqlFamilySpec {
  constructor() {
    super(new MariaDialect({}));
  }

  protected override jsonCastText(operand: string): string {
    return `JSON_EXTRACT(${operand}, '$')`;
  }

  protected override returningClause<E>(entity: Type<E>): string {
    return ' ' + this.dialect.returningId(entity);
  }

  shouldFilterByJsonDotNotation() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.public': 1,
      },
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` WHERE CAST(JSON_VALUE(`kind`, '$.public') AS DECIMAL) = ?");
    expect(ctx.values).toEqual([1]);
  }

  shouldSortByJsonDotNotation() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $sort: {
        'kind.theme.color': -1,
      } as any,
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY JSON_VALUE(`kind`, '$.theme.color') DESC");
  }

  shouldFilterByJsonDotNotationDeep() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.theme.color': 'red',
      } as any,
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` WHERE JSON_VALUE(`kind`, '$.theme.color') = ?");
    expect(ctx.values).toEqual(['red']);
  }

  /**
   * MariaDB needs `JSON_COMPACT` (bare `JSON_ARRAYAGG` re-quotes elements into strings) and
   * `JSON_EQUALS` (its JSON is text, so `<>` would compare textually).
   */
  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    unsetOnly: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(`kind`, '$.public', '$.private'), `updatedAt` = ? WHERE `id` = ?",
      values: [123, 1],
    },
    setUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    push: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
    pull: {
      sql: "UPDATE `Company` SET `kind` = JSON_REPLACE(`kind`, '$.tags', (SELECT COALESCE(JSON_ARRAYAGG(JSON_COMPACT(_uql_pull.v)), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) _uql_pull WHERE NOT JSON_EQUALS(_uql_pull.v, JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', 123, 1],
    },
    pullPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_REPLACE(`kind`, '$.tags', (SELECT COALESCE(JSON_ARRAYAGG(JSON_COMPACT(_uql_pull.v)), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) _uql_pull WHERE NOT JSON_EQUALS(_uql_pull.v, JSON_EXTRACT(?, '$')))), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', '"b"', 123, 1],
    },
    setPushCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', '"new-tag"', 123, 1],
    },
    setPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.tags', JSON_EXTRACT(?, '$')), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['["a"]', '"b"', 123, 1],
    },
    pushUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
  };

  shouldUpsertWithNoUpdateFields() {
    const { sql } = this.exec((ctx) => this.dialect.upsert(ctx, ItemTag, { id: true }, { id: 123 }));
    expect(sql).toContain('INSERT IGNORE');
  }

  /**
   * A `VECTOR` column takes a packed float32 blob, so a bound `'[1,2,3]'` is rejected outright
   * (`Incorrect vector value`) and reading the column raw hands back that blob. Both directions go
   * through MariaDB's text conversions, verified against MariaDB 12.3.
   */
  shouldInsertVectorThroughVecFromText() {
    const { sql, values } = this.exec((ctx) => this.dialect.insert(ctx, VectorItem, { vec: [1, 2, 3] }));
    expect(sql).toBe('INSERT INTO `VectorItem` (`vec`) VALUES (VEC_FromText(?)) RETURNING `id` `id`');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldReadVectorThroughVecToText() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, { $select: { id: true, name: true, vec: true } }),
    );
    expect(sql).toBe('SELECT `id`, `name`, VEC_ToText(`vec`) `vec` FROM `VectorItem`');
  }
}

createSpec(new MariaDialectSpec());
