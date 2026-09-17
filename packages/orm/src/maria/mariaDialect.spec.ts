import { expect } from 'vitest';
import type { JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { MySqlFamilySpec } from '../dialect/mysqlFamilyDialect-spec.js';
import { Company, ItemTag, MeasureUnitCategory, VectorItem } from '../test/index.js';
import { createSpec } from '../test/spec.util.js';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends MySqlFamilySpec {
  constructor() {
    super(new MariaDialect({}));
  }

  protected override jsonCastText(operand: string): string {
    return `JSON_EXTRACT(${operand}, '$')`;
  }

  protected override elemPath(field: string, json = false): string {
    return `${json ? 'JSON_EXTRACT' : 'JSON_VALUE'}(_uql_elem.v, '$.${field}')`;
  }

  protected override readonly elemSelect = 'SELECT 1';

  shouldFilterByJsonDotNotation() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.public': 1,
      },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `Company` WHERE CAST(JSON_VALUE(`kind`, '$.public') AS DOUBLE) = CAST(? AS DOUBLE)",
    );
    expect(ctx.values).toEqual([1]);
  }

  /** MariaDB orders JSON as text, so a number sorts by its value before the text breaks ties. */
  shouldSortByJsonDotNotation() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $sort: {
        'kind.theme.color': -1,
      },
    });
    const path = "JSON_VALUE(`kind`, '$.theme.color')";
    expect(ctx.sql).toBe(`SELECT \`id\` FROM \`Company\` ORDER BY CAST(${path} AS DOUBLE) DESC, ${path} DESC`);
  }

  shouldFilterByJsonDotNotationDeep() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.theme.color': 'red',
      },
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
      values: ['1', 123, '1'],
    },
    unsetOnly: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(`kind`, '$.public', '$.private'), `updatedAt` = ? WHERE `id` = ?",
      values: [123, '1'],
    },
    setUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, '1'],
    },
    push: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, '1'],
    },
    pull: {
      sql: "UPDATE `Company` SET `kind` = JSON_REPLACE(`kind`, '$.tags', CASE WHEN JSON_TYPE(JSON_EXTRACT(`kind`, '$.tags')) = 'ARRAY' THEN (SELECT COALESCE(JSON_ARRAYAGG(JSON_COMPACT(_uql_pull.v)), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) AS _uql_pull WHERE NOT JSON_EQUALS(_uql_pull.v, JSON_EXTRACT(?, '$'))) ELSE JSON_EXTRACT(`kind`, '$.tags') END), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', 123, '1'],
    },
    pullPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_REPLACE(`kind`, '$.tags', CASE WHEN JSON_TYPE(JSON_EXTRACT(`kind`, '$.tags')) = 'ARRAY' THEN (SELECT COALESCE(JSON_ARRAYAGG(JSON_COMPACT(_uql_pull.v)), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) AS _uql_pull WHERE NOT JSON_EQUALS(_uql_pull.v, JSON_EXTRACT(?, '$'))) ELSE JSON_EXTRACT(`kind`, '$.tags') END), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', '"b"', 123, '1'],
    },
    setPushCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', '"new-tag"', 123, '1'],
    },
    setPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.tags', JSON_EXTRACT(?, '$')), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['["a"]', '"b"', 123, '1'],
    },
    pushUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, '1'],
    },
  };

  shouldUpsertWithNoUpdateFields() {
    const { sql } = this.exec((ctx) => this.dialect.upsert(ctx, ItemTag, { id: true }, { id: '123' }));
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

  shouldReadVectorAsItsPackedBytes() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, { $select: { id: true, name: true, vec: true } }),
    );
    expect(sql).toBe("SELECT `id`, `name`, CONCAT('\\\\x', HEX(`vec`)) `vec` FROM `VectorItem`");
  }

  /**
   * A derived table reads no column of the statement around it here, so the aggregate reads the related
   * table itself and orders and pages inside `JSON_ARRAYAGG`, which takes both. `JSON_ARRAYAGG` is cut
   * at `group_concat_max_len` too, so the statement lifts it for itself alone.
   */
  shouldOrderAndPageInsideTheAggregate() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true, createdAt: true }, $sort: { name: 1 }, $limit: 5 } },
      }),
    );

    expect(sql).toBe(
      'SET STATEMENT group_concat_max_len=18446744073709551615 FOR' +
        " SELECT `MeasureUnitCategory`.`name`, COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('name', `measureUnits`.`name`," +
        " 'createdAt', CAST(`measureUnits`.`createdAt` AS CHAR)) ORDER BY `measureUnits`.`name` LIMIT 5)" +
        ' FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id`' +
        ' AND `measureUnits`.`deletedAt` IS NULL), JSON_ARRAY()) `measureUnits`' +
        ' FROM `MeasureUnitCategory` WHERE `MeasureUnitCategory`.`deletedAt` IS NULL',
    );
  }

  /** A joined row's columns go straight into the object, under their path. */
  shouldJoinAToOneInsideAToMany() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true }, $populate: { category: { $select: { name: true } } } } },
      }),
    );

    expect(sql).toBe(
      'SET STATEMENT group_concat_max_len=18446744073709551615 FOR' +
        " SELECT `MeasureUnitCategory`.`name`, COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('name', `measureUnits`.`name`," +
        " 'category.id', `category`.`id`, 'category.name', `category`.`name`))" +
        ' FROM `MeasureUnit` `measureUnits` LEFT JOIN `MeasureUnitCategory` `category` ON `category`.`id` = `measureUnits`.`categoryId`' +
        ' AND `category`.`deletedAt` IS NULL WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id`' +
        ' AND `measureUnits`.`deletedAt` IS NULL), JSON_ARRAY()) `measureUnits`' +
        ' FROM `MeasureUnitCategory` WHERE `MeasureUnitCategory`.`deletedAt` IS NULL',
    );
  }
}

createSpec(new MariaDialectSpec());
