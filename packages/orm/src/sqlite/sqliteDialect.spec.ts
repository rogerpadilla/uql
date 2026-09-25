import { expect } from 'vitest';
import { AbstractSqlDialectSpec, type JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { Entity, Field, Id, Index } from '../entity/index.js';
import {
  anyUuid,
  Company,
  createSpec,
  Item,
  ItemTag,
  JsonRecord,
  MeasureUnitCategory,
  Profile,
  TaxCategory,
  User,
} from '../test/index.js';
import { raw } from '../util/index.js';
import { SqliteDialect } from './sqliteDialect.js';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  /** A boolean stored as an integer. */
  protected override inlineLiterals() {
    return { quoted: "'it''s'", truth: '1' };
  }

  constructor() {
    super(new SqliteDialect({}));
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldGetBeginTransactionStatementsWithIsolationLevel() {
    // SQLite uses 'none' strategy - isolation level is silently ignored
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual(['BEGIN TRANSACTION']);
    expect(this.dialect.getBeginTransactionStatements('read committed')).toEqual(['BEGIN TRANSACTION']);
  }

  override shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        TaxCategory,
        { pk: true },
        {
          pk: 'a',
          name: 'Some Name D',
          createdAt: 1,
          updatedAt: 1,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(.*`pk`.*`name`.*`createdAt`.*`updatedAt`.*\) VALUES \(\?, \?, \?, \?\) ON CONFLICT \(`pk`\) DO UPDATE SET .*`name` = EXCLUDED.`name`.*`createdAt` = EXCLUDED.`createdAt`.*`updatedAt` = EXCLUDED.`updatedAt`.* RETURNING `pk` `id`$/,
    );
    expect(values).toEqual(['a', 'Some Name D', 1, 1]);
  }

  override shouldUpsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { email: true }, [
        {
          name: 'Name A',
          email: 'a@example.com',
          createdAt: 100,
        },
        {
          name: 'Name B',
          email: 'b@example.com',
          createdAt: 200,
        },
      ]),
    );
    expect(sql).toMatch(
      /^INSERT INTO `User` .*VALUES \(\?, \?, \?, \?\), \(\?, \?, \?, \?\) ON CONFLICT \(`email`\) DO UPDATE SET.* RETURNING `id` `id`$/,
    );
    expect(values).toHaveLength(9);
  }

  shouldUpsertWithDifferentColumnNames() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Profile,
        { pk: true },
        {
          pk: '1',
          picture: 'image.jpg',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `user_profile` \(.*`pk`.*`image`.*`createdAt`.*\) VALUES \(\?, \?, \?\) ON CONFLICT \(`pk`\) DO UPDATE SET .*`image` = EXCLUDED.`image`.*`updatedAt` = \?.*$/,
    );
    expect(values).toEqual(['1', 'image.jpg', expect.any(Number), expect.any(Number)]);
  }

  shouldUpsertWithNonUpdatableFields() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: '1',
          email: 'a@b.com',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `User` \(.*`id`.*`email`.*`createdAt`.*\) VALUES \(\?, \?, \?\) ON CONFLICT \(`id`\) DO UPDATE SET .*`updatedAt` = \?.*$/,
    );
    expect(values).toEqual(['1', 'a@b.com', expect.any(Number), expect.any(Number)]);
  }

  /**
   * SQLite has no `DEFAULT` keyword inside `VALUES`, so omitted columns insert `NULL` (which is
   * also how it auto-generates an INTEGER PRIMARY KEY for the record without an id).
   */
  override shouldInsertManyWithHeterogeneousColumns() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { id: '5', name: 'Some name 1', createdAt: 123 },
        { name: 'Some name 2', email: 'someemail2@example.com', createdAt: 456 },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO `User` (`id`, `name`, `createdAt`, `email`) VALUES (?, ?, ?, NULL), (?, ?, ?, ?) RETURNING `id` `id`',
    );
    expect(values).toEqual(['5', 'Some name 1', 123, anyUuid, 'Some name 2', 456, 'someemail2@example.com']);
  }

  /** With no `$fields`, the FTS5 column filter names the columns of the fulltext index the entity declares. */
  shouldSearchTheFulltextIndexWhereTextNamesNoFields() {
    @Entity()
    @Index((listing) => [listing.name, listing.description], { type: 'fulltext' })
    class Listing {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) name?: string | null;
      @Field({ type: String }) description?: string | null;
    }
    const { sql, values } = this.exec((ctx) => this.dialect.where(ctx, Listing, { $text: { $value: 'lamp' } }));
    expect(sql).toBe(' WHERE `Listing` MATCH ?');
    expect(values).toEqual(['{"name" "description"} : ("lamp")']);
  }

  /** SQLite has no `DEFAULT` in a multi-row `VALUES`, so a row missing a column writes its declared default. */
  shouldInsertTheDeclaredDefaultForAColumnARowLeavesOut() {
    @Entity()
    class Flagged {
      @Id({ type: Number }) id?: number;
      @Field({ type: String, defaultValue: 'active' }) status?: string | null;
    }
    const { sql, values } = this.exec((ctx) => this.dialect.insert(ctx, Flagged, [{ id: 1, status: 'x' }, { id: 2 }]));
    expect(sql).toBe('INSERT INTO `Flagged` (`id`, `status`) VALUES (?, ?), (?, ?) RETURNING `id` `id`');
    expect(values).toEqual([1, 'x', 2, 'active']);
  }

  shouldUpsertWithDoNothing() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        ItemTag,
        { id: true },
        {
          id: '1',
        },
      ),
    );
    expect(sql).toBe('INSERT INTO `ItemTag` (`id`) VALUES (?) ON CONFLICT (`id`) DO NOTHING RETURNING `id` `id`');
    expect(values).toEqual(['1']);
  }

  /** BM25 reads the match, so the rank binds nothing of its own. */
  protected override projectedTextRelevance(): { sql: string; values: unknown[] } {
    return {
      sql: 'SELECT `id`, -BM25(`Item`) `score` FROM `Item` WHERE `Item` MATCH ? ORDER BY `score` DESC',
      values: ['{"name"} : ("lamp")'],
    };
  }

  /** FTS5 matches the table, which under a join is read by its name, as the join qualifies every column. */
  protected override qualifiedTextSearchSql(): string {
    return 'SELECT `Item`.`id`, `tax`.`id` `tax.id`, `tax`.`name` `tax.name` FROM `Item` LEFT JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`taxId` WHERE `Item` MATCH ? ORDER BY -BM25(`Item`) DESC';
  }

  /** FTS5's `bm25` is lower for a better match, so it is negated to rank the way every other engine does. */
  override shouldSortBy$textRelevance() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: { name: true }, $value: 'lamp' } },
        $sort: { $text: 'desc', name: 'asc' },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `Item` MATCH ? ORDER BY -BM25(`Item`) DESC, `name`');
    expect(res.values).toEqual(['{"name"} : ("lamp")']);
  }

  override shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: { name: true, description: true }, $value: 'some text' }, companyId: '1' },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `Item` MATCH ? AND `companyId` = ? LIMIT 30');
    expect(res.values).toEqual(['{"name" "description"} : ("some" "text")', '1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: {
          $text: { $fields: { name: true }, $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: '1',
        },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `User` MATCH ? AND `name` <> ? AND `companyId` = ? LIMIT 10');
    expect(res.values).toEqual(['{"name"} : ("something")', 'other unwanted', '1']);
  }

  shouldHandleBoolean() {
    const { values } = this.exec((ctx) =>
      this.dialect.insert(ctx, Item, {
        inventoryable: true,
      }),
    );
    expect(values).toContain(1);

    const { values: values2 } = this.exec((ctx) =>
      this.dialect.insert(ctx, Item, {
        inventoryable: false,
      }),
    );
    expect(values2).toContain(0);
  }

  shouldEscape() {
    expect(this.dialect.escape("it's")).toBe("'it''s'");
  }
  shouldFind$elemMatch() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $elemMatch: { city: 'NYC', zip: '10001' } } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) _uql_elem WHERE JSON_EXTRACT(_uql_elem.value, '$.city') = ? AND JSON_EXTRACT(_uql_elem.value, '$.zip') = ?)",
    );
    expect(values).toEqual(['NYC', '10001']);
  }

  shouldFind$all() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $all: ['admin', 'user'] } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE (EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) _uql_elem WHERE `entries` -> _uql_elem.fullkey = JSON(?)) AND EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) _uql_elem WHERE `entries` -> _uql_elem.fullkey = JSON(?)))",
    );
    expect(values).toEqual(['"admin"', '"user"']);
  }

  shouldFind$size() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $size: 3 } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE JSON_ARRAY_LENGTH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) = ?",
    );
    expect(values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    // Single comparison operator
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $size: { $gte: 2 } } },
      }),
    );
    expect(res.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE JSON_ARRAY_LENGTH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) >= ?",
    );
    expect(res.values).toEqual([2]);

    // Multiple comparison operators
    res = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $size: { $gt: 0, $lte: 5 } } },
      }),
    );
    expect(res.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE (JSON_ARRAY_LENGTH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) > ? AND JSON_ARRAY_LENGTH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) <= ?)",
    );
    expect(res.values).toEqual([0, 5]);

    // $between
    res = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $size: { $between: [1, 10] } } },
      }),
    );
    expect(res.sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE JSON_ARRAY_LENGTH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) BETWEEN ? AND ?",
    );
    expect(res.values).toEqual([1, 10]);
  }

  shouldFind$elemMatchHoldingBesideAnOperator() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $elemMatch: { tags: ['a'], meta: { size: 1 }, price: { $gt: 1 } } } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) _uql_elem WHERE EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(_uql_elem.value, '$.tags') = 'array' THEN _uql_elem.value END, '$.tags') _uql_elem_2 WHERE _uql_elem.value -> _uql_elem_2.fullkey = JSON(?)) AND CAST(JSON_EXTRACT(_uql_elem.value, '$.meta.size') AS REAL) = CAST(? AS REAL) AND CAST(JSON_EXTRACT(_uql_elem.value, '$.price') AS REAL) > CAST(? AS REAL))",
    );
    expect(values).toEqual(['"a"', 1, 1]);
  }

  shouldFind$allHoldingANestedArray() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, { $select: { id: true }, $where: { entries: { $all: [['a']] } } }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) _uql_elem WHERE EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(_uql_elem.value) = 'array' THEN _uql_elem.value END) _uql_elem_2 WHERE _uql_elem.value -> _uql_elem_2.fullkey = JSON(?)))",
    );
    expect(values).toEqual(['"a"']);
  }

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $elemMatch: { city: { $ilike: 'new%' } } } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `JsonRecord` WHERE EXISTS (SELECT 1 FROM JSON_EACH(CASE WHEN JSON_TYPE(`entries`) = 'array' THEN `entries` END) _uql_elem WHERE JSON_EXTRACT(_uql_elem.value, '$.city') LIKE ? ESCAPE '\\')",
    );
    expect(values).toEqual(['new%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $elemMatch: { price: { $lt: 100 }, active: { $eq: true } } } },
      }),
    );
    expect(sql).toContain('EXISTS (SELECT 1 FROM JSON_EACH');
    expect(sql).toContain("CAST(JSON_EXTRACT(_uql_elem.value, '$.price') AS REAL) < CAST(? AS REAL)");
    expect(sql).toContain("(_uql_elem.value -> '$.active') = JSON(?)");
    // The boolean binds as JSON text, not as SQLite's 0/1 integer.
    expect(values).toEqual([100, 'true']);
  }

  shouldFind$elemMatchWithAllOperators() {
    // Test $ne, $gt, $gte, $lte
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: {
          entries: {
            $elemMatch: {
              a: { $ne: 'x' },
              b: { $gt: 5 },
              c: { $gte: 10 },
              active: { $eq: true },
            },
          },
        },
      }),
    );
    expect(res.sql).toContain("JSON_EXTRACT(_uql_elem.value, '$.a') <> ?");
    expect(res.sql).toContain("CAST(JSON_EXTRACT(_uql_elem.value, '$.b') AS REAL) > CAST(? AS REAL)");
    expect(res.sql).toContain("CAST(JSON_EXTRACT(_uql_elem.value, '$.c') AS REAL) >= CAST(? AS REAL)");
    expect(res.sql).toContain("(_uql_elem.value -> '$.active') = JSON(?)");
    expect(res.values).toContain('true');

    // Test $like, $startsWith, $endsWith
    res = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: {
          entries: {
            $elemMatch: {
              a: { $like: '%x%' },
              b: { $startsWith: 'hi' },
              c: { $endsWith: 'bye' },
              d: { $istartsWith: 'HI' },
              e: { $iendsWith: 'BYE' },
              f: { $includes: 'mid' },
              g: { $iincludes: 'MID' },
            },
          },
        },
      }),
    );
    expect(res.sql).toContain("JSON_EXTRACT(_uql_elem.value, '$.a') LIKE ? ESCAPE '\\'");
    expect(res.sql).toContain("JSON_EXTRACT(_uql_elem.value, '$.d') LIKE ? ESCAPE '\\'");
    expect(res.sql).toContain("JSON_EXTRACT(_uql_elem.value, '$.e') LIKE ? ESCAPE '\\'");
    expect(res.sql).toContain("JSON_EXTRACT(_uql_elem.value, '$.g') LIKE ? ESCAPE '\\'");

    // Test $regex
    res = this.exec((ctx) =>
      this.dialect.find(ctx, JsonRecord, {
        $select: { id: true },
        $where: { entries: { $elemMatch: { code: { $regex: '^A' } } } },
      }),
    );
    expect(res.sql).toContain("JSON_EXTRACT(_uql_elem.value, '$.code') REGEXP ?");
  }
  shouldFindByJsonDotNotation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': 1 },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `Company` WHERE CAST(JSON_EXTRACT(`kind`, '$.public') AS REAL) = CAST(? AS REAL)",
    );
    expect(values).toEqual([1]);
  }

  shouldFindByJsonDotNotationWithOperator() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $ne: 0 } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `Company` WHERE CAST(JSON_EXTRACT(`kind`, '$.public') AS REAL) <> CAST(? AS REAL)",
    );
    expect(values).toEqual([0]);
  }

  shouldFindByJsonDotNotationWithNumericCast() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $gt: 0 } },
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `Company` WHERE CAST(JSON_EXTRACT(`kind`, '$.public') AS REAL) > CAST(? AS REAL)",
    );
    expect(values).toEqual([0]);
  }

  shouldFindByJsonDotNotationDeepPath() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.theme.color': 'red' },
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE JSON_EXTRACT(`kind`, '$.theme.color') = ?");
    expect(values).toEqual(['red']);
  }

  /** SQLite's `LIKE` already ignores ASCII case, so `$ilike` is a plain `LIKE`. */
  shouldFindByJsonDotNotationWithIlike() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.country': { $ilike: '%land%' } },
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE JSON_EXTRACT(`kind`, '$.country') LIKE ? ESCAPE '\\'");
    expect(values).toEqual(['%land%']);
  }
  shouldFindByManyToManyRelation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { tags: { id: '5' } },
      }),
    );
    expect(sql).toBe(
      'SELECT `id` FROM `Item` WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `tags`.`id` FROM `Tag` `tags` WHERE `tags`.`id` = ?))',
    );
    expect(values).toEqual(['5']);
  }

  shouldFindByOneToManyRelation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { id: true },
        $where: { measureUnits: { name: 'kg' } },
      }),
    );
    // MeasureUnitCategory has softDelete -> parent query adds AND `deletedAt` IS NULL
    expect(sql).toBe(
      'SELECT `id` FROM `MeasureUnitCategory` WHERE EXISTS (SELECT 1 FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id` AND `measureUnits`.`name` = ? AND `measureUnits`.`deletedAt` IS NULL) AND `deletedAt` IS NULL',
    );
    expect(values).toEqual(['kg']);
  }

  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, '1'],
    },
    unsetOnly: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(`kind`, '$.public', '$.private'), `updatedAt` = ? WHERE `id` = ?",
      values: [123, '1'],
    },
    setUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON(?)), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, '1'],
    },
    push: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(`kind`, '$.tags[#]', JSON(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, '1'],
    },
    /**
     * Elements are read back via `->` at their own `fullkey`, which preserves each element's JSON
     * type; `JSON_EACH`'s `value` column would flatten booleans to 0/1 and stringify objects.
     */
    pull: {
      sql: "UPDATE `Company` SET `kind` = JSON_REPLACE(`kind`, '$.tags', CASE WHEN JSON_TYPE(`kind`, '$.tags') = 'array' THEN (SELECT JSON_GROUP_ARRAY(JSON(`kind` -> _uql_pull.fullkey)) FROM JSON_EACH(CASE WHEN JSON_TYPE(`kind`, '$.tags') = 'array' THEN `kind` END, '$.tags') _uql_pull WHERE `kind` -> _uql_pull.fullkey <> JSON(?)) ELSE (`kind` -> '$.tags') END), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', 123, '1'],
    },
    pullPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(JSON_REPLACE(`kind`, '$.tags', CASE WHEN JSON_TYPE(`kind`, '$.tags') = 'array' THEN (SELECT JSON_GROUP_ARRAY(JSON(`kind` -> _uql_pull.fullkey)) FROM JSON_EACH(CASE WHEN JSON_TYPE(`kind`, '$.tags') = 'array' THEN `kind` END, '$.tags') _uql_pull WHERE `kind` -> _uql_pull.fullkey <> JSON(?)) ELSE (`kind` -> '$.tags') END), '$.tags[#]', JSON(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', '"b"', 123, '1'],
    },
    setPushCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON(?)), '$.tags[#]', JSON(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', '"new-tag"', 123, '1'],
    },
    setPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(JSON_SET(COALESCE(`kind`, '{}'), '$.tags', JSON(?)), '$.tags[#]', JSON(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['["a"]', '"b"', 123, '1'],
    },
    pushUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_SET(`kind`, '$.tags[#]', JSON(?)), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, '1'],
    },
  };

  shouldSortByJsonDotNotation() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.public': 1 },
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` ORDER BY JSON_EXTRACT(`kind`, '$.public')");
  }

  shouldSortByJsonDotNotationDeep() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.theme.color': -1 },
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` ORDER BY JSON_EXTRACT(`kind`, '$.theme.color') DESC");
  }

  /** Outside the types, which give a JSON key no `raw()`: rendered in place rather than bound as an object. */
  shouldSetAJsonKeyToARawExpression() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: '1' } },
        {
          // @ts-expect-error: a JSON key takes no `raw`
          kind: { $set: { private: raw`1 + ${1}` } },
        },
      ),
    );
    expect(sql).toBe(
      "UPDATE `Company` SET `kind` = JSON_SET(COALESCE(`kind`, '{}'), '$.private', 1 + ?), `updatedAt` = ? WHERE `id` = ?",
    );
    expect(values).toEqual([1, expect.any(Number), '1']);
  }

  /** `json_group_array` over the rows, ordered by the sort terms they carry out beside them. */
  shouldReadAToManyInsideItsParentStatement() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true, createdAt: true }, $sort: { name: 1 }, $limit: 5 } },
      }),
    );

    expect(sql).toBe(
      "SELECT `MeasureUnitCategory`.`name`, (SELECT json_group_array(json_object('name', `measureUnits`.`name`," +
        " 'createdAt', `measureUnits`.`createdAt`) ORDER BY `measureUnits`.`_uql_sort_name`)" +
        ' FROM (SELECT `measureUnits`.`name`, CAST(`measureUnits`.`createdAt` AS TEXT) `createdAt`, `measureUnits`.`name` `_uql_sort_name`' +
        ' FROM `MeasureUnit` `measureUnits` WHERE `measureUnits`.`categoryId` = `MeasureUnitCategory`.`id`' +
        ' AND `measureUnits`.`deletedAt` IS NULL ORDER BY `_uql_sort_name` LIMIT 5) `measureUnits`) `measureUnits`' +
        ' FROM `MeasureUnitCategory` WHERE `MeasureUnitCategory`.`deletedAt` IS NULL',
    );
  }
}

createSpec(new SqliteDialectSpec());
