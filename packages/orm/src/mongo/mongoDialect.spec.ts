import { ObjectId } from 'mongodb';
import { expect } from 'vitest';
import { UqlSecurityError, withContext } from '../context/context.js';
import { AGGREGATE_VALUE_ALIAS, REL_TEMP_PREFIX } from '../dialect/aliases.js';
import { Entity, Field, Filter, getMeta, Id, Index, ManyToOne, OneToMany } from '../entity/index.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/snakeCaseNamingStrategy.js';
import {
  Company,
  createSpec,
  Invoice,
  Item,
  ItemAdjustment,
  JsonRecord,
  MeasureUnit,
  MeasureUnitCategory,
  type Spec,
  Tax,
  TaxCategory,
  User,
  VectorItem,
} from '../test/index.js';
import { type FieldKey, idKey, type QueryRaw, type QueryWhere } from '../type/index.js';
import { raw } from '../util/index.js';
import { MongoDialect } from './mongoDialect.js';

declare module '../type/index.js' {
  interface UqlContext {
    secureTenantId?: number;
  }
}

/** The joined (m1) side of a `security: true` filter - the regression case for the $lookup/populate gap. */
@Filter('tenant', {
  where: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
  security: true,
})
@Entity()
class SecureRelated {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number | null;
  @Field({ type: String })
  name?: string | null;
}

/** A string key and a string reference: the shape the two wire seams convert. */
@Entity()
class Doc {
  @Id({ type: String })
  id?: string;
  @Field({ references: () => Doc })
  parentId?: string | null;
  @Field({ type: String })
  title?: string | null;
}

@Entity()
class SecureParent {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureRelated })
  relatedId?: number | null;
  @ManyToOne({ entity: () => SecureRelated, references: (secureParent) => secureParent.relatedId })
  related?: SecureRelated;
}

/**
 * Every read path has to address the *stored* names: the primary key is `_id` and a `@Field({ name })`
 * column is not its property key. No other fixture renames anything, which is why projecting, sorting
 * and grouping by the property name went unnoticed.
 */
@Entity({ name: 'renamed_doc' })
class RenamedDoc {
  @Id({ type: Number })
  id?: number;
  @Field({ type: String, name: 'the_label' })
  label?: string | null;
  @Field({ type: Date, name: 'deleted_at', softDelete: true })
  deletedAt?: Date | null;
}

@Entity()
class AggregateLine {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => AggregateDoc, type: Number })
  docId?: number | null;
  @Field({ type: Number })
  price?: number | null;
}

/** Relation aggregates a document engine builds out of stages: one over a page, one over a filtered page. */
@Entity()
class AggregateDoc {
  @Id({ type: Number })
  id?: number;
  @OneToMany({ entity: () => AggregateLine, mappedBy: (line) => line.docId })
  lines?: AggregateLine[];
  @Field({ computed: (doc) => doc.lines.max((line) => line.price, { $sort: { price: -1 }, $limit: 2 }) })
  readonly topPrice?: number | null;
  @Field({
    computed: (doc) =>
      doc.lines.sum((line) => line.price, { $where: { price: { $gt: 0 } }, $sort: { price: 1 }, $limit: 5, $skip: 1 }),
  })
  readonly laterTotal?: number;
}

/** The other arm of `computed`: SQL, which no document engine evaluates. */
@Entity()
class SqlComputedDoc {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  price?: number | null;
  @Field({ type: Number, computed: (doc) => raw`${doc.price} * 2` })
  readonly doubled?: number | null;
}

class MongoDialectSpec implements Spec {
  dialect!: MongoDialect;

  beforeEach() {
    this.dialect = new MongoDialect();
  }

  /** MongoDB has no root `$not`, so both negations become its `$nor`. */
  shouldBuildWhereWithRootNegations() {
    expect(this.dialect.where(Item, { $not: [{ name: 'a' }] })).toEqual({ $nor: [{ name: 'a' }] });

    expect(this.dialect.where(Item, { $nor: [{ name: 'a' }, { code: 'c' }] })).toEqual({
      $nor: [{ name: 'a' }, { code: 'c' }],
    });

    // `$not` joins with AND before negating, so its clauses need wrapping; `$nor` already is a NOT-OR.
    expect(this.dialect.where(Item, { $not: [{ name: 'a' }, { code: 'c' }] })).toEqual({
      $nor: [{ $and: [{ name: 'a' }, { code: 'c' }] }],
    });

    // `NOT a AND NOT b` is one `$nor` of both, so two negations at root merge instead of colliding.
    expect(this.dialect.where(Item, { $not: [{ name: 'a' }], $nor: [{ code: 'c' }] })).toEqual({
      $nor: [{ name: 'a' }, { code: 'c' }],
    });

    // MongoDB rejects an empty `$and`/`$or`/`$nor`, and a clause that renders to nothing leaves none.
    expect(this.dialect.where(Item, { $nor: [] })).toEqual({});
    expect(this.dialect.where(Item, { $and: [] })).toEqual({});
    expect(this.dialect.where(Item, { $nor: [{}] })).toEqual({});
  }

  /**
   * `/http` casts client JSON straight to `Query`, so a scalar reaches here where an array belongs.
   * Both backends share the guard, so both name the operator and the type they got.
   */
  shouldRejectANonArrayLogicalOperator() {
    // @ts-expect-error: `$and` takes a list
    expect(() => this.dialect.where(Item, { $and: 'foo' })).toThrow('$and expects an array, got string');
    // @ts-expect-error: `$or` takes a list
    expect(() => this.dialect.where(Item, { $or: { name: 'a' } })).toThrow('$or expects an array, got object');
    // @ts-expect-error: `$nor` takes a list
    expect(() => this.dialect.where(Item, { $nor: null })).toThrow('$nor expects an array, got null');
  }

  shouldBuildWhere() {
    expect(this.dialect.where(Item, undefined)).toEqual({});

    expect(this.dialect.where(Item, {})).toEqual({});

    expect(this.dialect.where(Item, { code: '123' })).toEqual({ code: '123' });

    expect(this.dialect.where(Item, { $and: [{ code: '123', name: 'abc' }] })).toEqual({
      $and: [{ code: '123', name: 'abc' }],
    });

    expect(
      this.dialect.where(TaxCategory, {
        creatorId: '1',
        $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
        pk: '507f191e810c19729de860ea',
      }),
    ).toEqual({
      creatorId: '1',
      $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, { id: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    // @ts-expect-error: the driver's own id, where the entity declares a string
    expect(this.dialect.where(Item, { id: new ObjectId('507f191e810c19729de860ea') })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, { pk: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    // @ts-expect-error: the driver's own id, where the entity declares a string
    expect(this.dialect.where(TaxCategory, { pk: new ObjectId('507f191e810c19729de860ea') })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });
  }

  shouldSelect() {
    expect(this.dialect.select(Tax, { name: true })).toEqual({ name: 1 });
    // the primary key is stored as `_id`; `normalizeId` maps it back to `id` on the way out
    expect(this.dialect.select(Tax, { id: true, name: true })).toEqual({ _id: 1, name: 1 });
  }

  shouldThrowOnRawSelectArray() {
    expect(() => this.dialect.select(Tax, [raw`*`])).toThrow('raw $select is not supported on MongoDB');
  }

  /** A relation's projection runs inside its lookup, which refuses a raw one as the statement's does. */
  shouldThrowOnRawSelectArrayInARelation() {
    const $select = [raw`*`];
    expect(() => this.dialect.aggregationPipeline(Item, { $populate: { tax: { $select } } })).toThrow(
      'raw $select is not supported on MongoDB',
    );
    expect(() => this.dialect.aggregationPipeline(Item, { $populate: { tags: { $select } } })).toThrow(
      'raw $select is not supported on MongoDB',
    );
  }

  /** Reads address the stored column, never the property key. */
  shouldAddressStoredColumnsForRenamedFields() {
    expect(this.dialect.select(RenamedDoc, { id: true, label: true })).toEqual({ _id: 1, the_label: 1 });
    expect(this.dialect.sort(RenamedDoc, { label: -1, id: 1 })).toEqual({ the_label: -1, _id: 1 });
    expect(this.dialect.where(RenamedDoc, { label: 'x' })).toEqual({ the_label: 'x', deleted_at: null });
    // group by the column, project back under the caller's key
    expect(this.dialect.buildAggregateStages(RenamedDoc, { $group: { label: true }, $select: { n: { $count: '*' } } })) //
      .toEqual([
        { $match: { deleted_at: null } },
        { $group: { _id: { label: '$the_label' }, n: { $sum: 1 } } },
        { $project: { _id: 0, label: '$_id.label', n: 1 } },
      ]);
  }

  /** The built-in soft-delete filter reads the renamed column, so deletes must stamp that same one. */
  shouldFilterRenamedSoftDeleteColumn() {
    expect(this.dialect.where(RenamedDoc, {})).toEqual({ deleted_at: null });
  }

  /** The inverse (11) side correlates per parent document, not by the query's own `_id`. */
  shouldCorrelateInverseOneToOnePopulateWithoutAnIdFilter() {
    expect(
      this.dialect.aggregationPipeline(User, { $where: { email: 'a@b.c' }, $populate: { profile: true } }),
    ).toEqual([
      { $match: { email: 'a@b.c' } },
      { $lookup: { from: 'user_profile', localField: '_id', foreignField: 'creatorId', as: 'profile' } },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    ]);
  }

  /** A relation-level `$where` belongs in the lookup, like the SQL dialects' JOIN ON clause. */
  shouldApplyRelationLevelWhereToLookup() {
    expect(this.dialect.aggregationPipeline(Item, { $populate: { tax: { $where: { name: 'VAT' } } } })).toEqual([
      {
        $lookup: {
          from: 'Tax',
          localField: 'taxId',
          foreignField: '_id',
          pipeline: [{ $match: { name: 'VAT' } }],
          as: 'tax',
        },
      },
      { $unwind: { path: '$tax', preserveNullAndEmptyArrays: true } },
    ]);
  }

  /**
   * A relation of a relation is looked up inside the outer lookup's own pipeline, before the projection
   * that reads it.
   */
  shouldNestLookupsForNestedPopulate() {
    expect(
      this.dialect.aggregationPipeline(Item, {
        $select: { id: true },
        $populate: { tax: { $select: { name: true }, $populate: { category: { $select: { name: true } } } } },
      }),
    ).toEqual([
      {
        $lookup: {
          from: 'Tax',
          localField: 'taxId',
          foreignField: '_id',
          pipeline: [
            {
              $lookup: {
                from: 'TaxCategory',
                localField: 'categoryId',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1 } }],
                as: 'category',
              },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            { $project: { name: 1, category: 1 } },
          ],
          as: 'tax',
        },
      },
      { $unwind: { path: '$tax', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, tax: 1 } },
    ]);
  }

  /** `$required` drops parents with no match - the aggregation equivalent of an INNER JOIN. */
  shouldDropUnmatchedParentsForRequiredPopulate() {
    const [, unwind] = this.dialect.aggregationPipeline(Item, { $populate: { tax: { $required: true } } });
    expect(unwind).toEqual({ $unwind: { path: '$tax', preserveNullAndEmptyArrays: false } });
  }

  /** `$exclude` of the primary key needs `_id: 0`: MongoDB returns `_id` unless told not to. */
  shouldExcludePrimaryKeyExplicitly() {
    expect(this.dialect.select(RenamedDoc, undefined, { id: true })).toEqual({ the_label: 1, deleted_at: 1, _id: 0 });
  }

  /** ...and a populated query too: its lookups read the key before the projection drops it. */
  shouldExcludeThePrimaryKeyBesideAPopulatedRelation() {
    const pipeline = this.dialect.aggregationPipeline(Item, {
      $exclude: { id: true },
      $populate: { tax: true, tags: true },
    });
    const projections = pipeline.filter((stage) => stage.$project && stage.$project['tax']);
    expect(projections).toHaveLength(1);
    expect(projections[0].$project).toMatchObject({ _id: 0, tax: 1, tags: 1 });
  }

  /**
   * A relation aggregate is data, not SQL, so MongoDB builds it: the lookup that reads the related rows
   * and the `$addFields` putting its value on the document, under the field's own name.
   */
  shouldReadARelationAggregateAsALookup() {
    const [lookup, added] = this.dialect.aggregationPipeline(Item, { $select: { tagsCount: true } });
    expect(lookup).toMatchObject({ $lookup: { from: 'ItemTag', as: `${REL_TEMP_PREFIX}tagsCount` } });
    expect(added).toEqual({
      $addFields: {
        tagsCount: { $ifNull: [{ $arrayElemAt: [`$${REL_TEMP_PREFIX}tagsCount.${AGGREGATE_VALUE_ALIAS}`, 0] }, 0] },
      },
    });
  }

  /** ...and only where a query names it: an aggregate reads the related rows, as a relation does. */
  shouldLeaveARelationAggregateOutOfAReadThatDoesNotNameIt() {
    const pipeline = this.dialect.aggregationPipeline(Item, { $populate: { tax: true } });
    expect(pipeline.some((stage) => '$addFields' in stage)).toBe(false);
    expect(this.dialect.select(Item, undefined, { id: true })).not.toHaveProperty('tagsCount');
  }

  /**
   * A value aggregate groups the related rows; a page reads them ordered first, since the order is what
   * picks which ones it reads. `null` where nothing matched, which is what the field's type says.
   */
  shouldReadAValueAggregateOverAPage() {
    const [lookup, added] = this.dialect.aggregationPipeline(AggregateDoc, { $select: { topPrice: true } });
    expect(lookup).toMatchObject({
      $lookup: {
        from: 'AggregateLine',
        pipeline: [
          { $sort: { price: -1 } },
          { $limit: 2 },
          { $group: { _id: null, [AGGREGATE_VALUE_ALIAS]: { $max: '$price' } } },
        ],
      },
    });
    expect(added).toEqual({
      $addFields: {
        topPrice: { $ifNull: [{ $arrayElemAt: [`$${REL_TEMP_PREFIX}topPrice.${AGGREGATE_VALUE_ALIAS}`, 0] }, null] },
      },
    });
  }

  /** A total skips as well as limits, and answers `0` over no rows, as its type says. */
  shouldReadATotalOverAPageThatSkips() {
    const [lookup, added] = this.dialect.aggregationPipeline(AggregateDoc, { $select: { laterTotal: true } });
    expect(lookup).toMatchObject({
      $lookup: {
        pipeline: [
          { $match: { price: { $gt: 0 } } },
          { $sort: { price: 1 } },
          { $skip: 1 },
          { $limit: 5 },
          { $group: { _id: null, [AGGREGATE_VALUE_ALIAS]: { $sum: '$price' } } },
        ],
      },
    });
    expect(added).toEqual({
      $addFields: {
        laterTotal: { $ifNull: [{ $arrayElemAt: [`$${REL_TEMP_PREFIX}laterTotal.${AGGREGATE_VALUE_ALIAS}`, 0] }, 0] },
      },
    });
  }

  /** The other arm stays refused: projecting the property name would answer `undefined` for every row. */
  shouldRefuseASqlComputedFieldAQueryNames() {
    const message = "cannot read 'SqlComputedDoc.doubled' on MongoDB";
    expect(() => this.dialect.select(SqlComputedDoc, { doubled: true })).toThrow(message);
    expect(() => this.dialect.where(SqlComputedDoc, { doubled: { $gt: 1 } })).toThrow(message);
    expect(() => this.dialect.aggregationPipeline(SqlComputedDoc, { $sort: { doubled: -1 } })).toThrow(message);
  }

  shouldThrowOnRawInWhere() {
    expect(() => this.dialect.where(Item, { $and: [raw`code IS NOT NULL`] })).toThrow(
      'raw() in $where is not supported on MongoDB',
    );
    expect(() => this.dialect.where(Item, { name: raw`lower(code)` })).toThrow(
      'raw() in $where is not supported on MongoDB',
    );
  }

  /**
   * Every other dialect compiles `$near` to a distance expression. Atlas has none - it scores by the
   * index's own `similarity`, which UQL never sees - so this refuses rather than guessing the scale
   * and filtering the wrong rows. Without the explicit arm, `transformOperators` would have passed
   * `$near` through to the server as a bogus operator name.
   */
  shouldThrowOnNearInWhere() {
    // @ts-expect-error: `$near` is for a vector field
    expect(() => this.dialect.where(Item, { name: { $near: { $vector: [1, 2, 3], $lt: 0.35 } } })).toThrow(
      '$near is not supported on MongoDB',
    );
  }

  /**
   * A relation condition becomes one correlated `$lookup` into a temporary field plus a condition on
   * it. `$limit: 1` is enough for existence, and the target's own filters scope the lookup.
   */
  shouldFilterByOneToManyRelation() {
    expect(this.dialect.matchStages(MeasureUnitCategory, { measureUnits: { name: 'kg' } })).toEqual([
      {
        $lookup: {
          from: 'MeasureUnit',
          localField: '_id',
          foreignField: 'categoryId',
          pipeline: [{ $match: { name: 'kg', deletedAt: null } }, { $limit: 1 }],
          as: '_uql_rel_0',
        },
      },
      { $match: { '_uql_rel_0.0': { $exists: true }, deletedAt: null } },
      { $unset: ['_uql_rel_0'] },
    ]);
  }

  /** ManyToMany reaches the target from inside the junction's lookup, so no ids are materialized. */
  shouldFilterByManyToManyRelationThroughTheJunction() {
    expect(this.dialect.matchStages(Item, { tags: { name: 'urgent' } })).toEqual([
      {
        $lookup: {
          from: 'ItemTag',
          localField: '_id',
          foreignField: 'itemId',
          pipeline: [
            {
              $lookup: {
                from: 'Tag',
                localField: 'tagId',
                foreignField: '_id',
                pipeline: [{ $match: { name: 'urgent' } }, { $limit: 1 }],
                as: '_uql_target',
              },
            },
            { $match: { '_uql_target.0': { $exists: true } } },
            { $limit: 1 },
          ],
          as: '_uql_rel_0',
        },
      },
      { $match: { '_uql_rel_0.0': { $exists: true } } },
      { $unset: ['_uql_rel_0'] },
    ]);
  }

  /** `$size` counts inside the lookup; `$ifNull` makes an empty result compare as 0. */
  shouldCompareRelationSize() {
    const count = { $ifNull: [{ $arrayElemAt: [`$_uql_rel_0.${AGGREGATE_VALUE_ALIAS}`, 0] }, 0] };

    const exact = this.dialect.matchStages(MeasureUnitCategory, { measureUnits: { $size: 0 } });
    expect(exact[0]?.$lookup?.pipeline).toEqual([{ $match: { deletedAt: null } }, { $count: AGGREGATE_VALUE_ALIAS }]);
    expect(exact).toContainEqual({ $match: { $expr: { $eq: [count, 0] }, deletedAt: null } });

    const single = this.dialect.matchStages(MeasureUnitCategory, { measureUnits: { $size: { $gte: 2 } } });
    expect(single).toContainEqual({ $match: { $expr: { $gte: [count, 2] }, deletedAt: null } });

    const between = this.dialect.matchStages(MeasureUnitCategory, { measureUnits: { $size: { $between: [2, 5] } } });
    expect(between).toContainEqual({
      $match: { $expr: { $and: [{ $gte: [count, 2] }, { $lte: [count, 5] }] }, deletedAt: null },
    });

    const combined = this.dialect.matchStages(MeasureUnitCategory, { measureUnits: { $size: { $gt: 1, $lt: 9 } } });
    expect(combined).toContainEqual({
      $match: { $expr: { $and: [{ $gt: [count, 1] }, { $lt: [count, 9] }] }, deletedAt: null },
    });
  }

  shouldThrowOnEmptyRelationSizeComparison() {
    expect(() =>
      this.dialect.matchStages(MeasureUnitCategory, { measureUnits: { $size: { $gte: undefined } } }),
    ).toThrow('$size needs at least one comparison');
  }

  /** Each relation `$size` of one `$where` joins its `$expr`, where the last one replaced the others. */
  shouldApplyEveryRelationSize() {
    @Entity()
    class Shelf {
      @Id({ type: String }) id?: string;
      @OneToMany({ entity: () => Book, mappedBy: (book) => book.shelfId }) books?: Book[];
      @OneToMany({ entity: () => Lamp, mappedBy: (lamp) => lamp.shelfId }) lamps?: Lamp[];
    }
    @Entity()
    class Book {
      @Id({ type: String }) id?: string;
      @Field({ references: () => Shelf }) shelfId?: string | null;
    }
    @Entity()
    class Lamp {
      @Id({ type: String }) id?: string;
      @Field({ references: () => Shelf }) shelfId?: string | null;
    }
    const tally = (temp: string) => ({ $ifNull: [{ $arrayElemAt: [`$${temp}.${AGGREGATE_VALUE_ALIAS}`, 0] }, 0] });

    const stages = this.dialect.matchStages(Shelf, { books: { $size: 1 }, lamps: { $size: 2 } });

    expect(stages.filter((stage) => '$lookup' in stage)).toHaveLength(2);
    expect(stages).toContainEqual({
      $match: { $expr: { $and: [{ $eq: [tally('_uql_rel_0'), 1] }, { $eq: [tally('_uql_rel_1'), 2] }] } },
    });
  }

  /** MongoDB's `$size` takes only a number, so bounds are counted in an `$expr`, which only an array meets. */
  shouldCountAnArrayAgainstSizeBounds() {
    const count = { $size: { $cond: [{ $isArray: '$entries' }, '$entries', []] } };
    expect(this.dialect.where(JsonRecord, { entries: { $size: { $gte: 1, $lt: 3 }, $all: ['a'] } })).toEqual({
      entries: { $all: ['a'] },
      $expr: { $and: [{ $isArray: '$entries' }, { $and: [{ $gte: [count, 1] }, { $lt: [count, 3] }] }] },
    });
  }

  /**
   * The lookups are hoisted as pre-stages while the condition stays where the caller put it, so a
   * relation inside `$or` still means what it says.
   */
  shouldKeepRelationConditionInsideOr() {
    const stages = this.dialect.matchStages(MeasureUnitCategory, {
      $or: [{ name: 'weight' }, { measureUnits: { name: 'kg' } }],
    });
    expect(stages.filter((stage) => '$lookup' in stage)).toHaveLength(1);
    expect(stages).toContainEqual({
      $match: { $or: [{ name: 'weight' }, { '_uql_rel_0.0': { $exists: true } }], deletedAt: null },
    });
  }

  shouldReportWhetherAWhereConstrainsRelations() {
    expect(this.dialect.constrainsRelations(Item, undefined)).toBe(false);
    expect(this.dialect.constrainsRelations(Item, { name: 'x' })).toBe(false);
    expect(this.dialect.constrainsRelations(Item, { tags: { name: 'x' } })).toBe(true);
    expect(this.dialect.constrainsRelations(Item, { $or: [{ tags: { name: 'x' } }] })).toBe(true);
    // A negation groups clauses like `$and`/`$or` do, so a relation inside one needs the same
    // aggregation path - missing these was a relation filter throwing as unsupported.
    expect(this.dialect.constrainsRelations(Item, { $not: [{ tags: { name: 'x' } }] })).toBe(true);
    expect(this.dialect.constrainsRelations(Item, { $nor: [{ tags: { name: 'x' } }] })).toBe(true);
    expect(this.dialect.constrainsRelations(Item, { $nor: [] })).toBe(false);
    // Refused later by the render, rather than recursing forever on the way there.
    expect(this.dialect.constrainsRelations(Item, { $or: [raw`code IS NOT NULL`] })).toBe(false);
    // A relation aggregate reads the relation's rows too.
    expect(this.dialect.constrainsRelations(Item, { $or: [{ tagsCount: { $gt: 1 } }] })).toBe(true);
  }

  /** A plain filter (`find`, `updateMany`) has nowhere to put the lookups a relation condition needs. */
  shouldThrowOnRelationInPlainFilter() {
    expect(() => this.dialect.where(Item, { tax: { name: 'VAT' } })).toThrow(
      "filtering by relation 'tax' is not supported here on MongoDB",
    );
    expect(() => this.dialect.where(Item, { tags: { $size: 2 } })).toThrow(
      "filtering by relation 'tags' is not supported here on MongoDB",
    );
    expect(() => this.dialect.where(Item, { $or: [{ tagsCount: 2 }] })).toThrow(
      "filtering by relation aggregate 'tagsCount' is not supported here on MongoDB",
    );
  }

  /** A relation aggregate sits on the document under its column, like any field, which every clause reads. */
  shouldPutARelationAggregateUnderItsColumn() {
    const dialect = new MongoDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
    const stages = dialect.buildAggregateStages(MeasureUnitCategory, {
      $where: { unitCount: { $gte: 1 } },
      $group: { unitCount: true },
      $select: { n: { $count: '*' } },
    });
    expect(Object.keys(stages[1]?.['$addFields'] ?? {})).toEqual(['unit_count']);
    expect(stages[2]).toEqual({ $match: { deleted_at: null, unit_count: { $gte: 1 } } });
    expect(stages[4]).toEqual({ $group: { _id: { unitCount: '$unit_count' }, n: { $sum: 1 } } });
    expect(dialect.select(MeasureUnitCategory, { unitCount: true })).toEqual({ unit_count: 1 });
  }

  /** A relation aggregate read by several clauses is put on the document once. */
  shouldLookUpARelationAggregateOnce() {
    const stages = this.dialect.matchStages(Item, { $or: [{ tagsCount: 1 }, { tagsCount: { $gt: 3 } }] }, {}, [
      'tagsCount',
    ]);
    expect(stages.filter((stage) => '$lookup' in stage)).toHaveLength(1);
    expect(stages).toContainEqual({ $match: { $or: [{ tagsCount: 1 }, { tagsCount: { $gt: 3 } }] } });
  }

  /** A populated to-one is a field of the unwound document, so it sorts by its own column name. */
  shouldSortByRelationField() {
    expect(this.dialect.sort(Item, { tax: { name: -1 } }, { tax: true })).toEqual({ 'tax.name': -1 });
    expect(this.dialect.sort(User, { profile: { picture: 1 } }, { profile: true })).toEqual({
      'profile.image': 1,
    });
    // As many of its fields as the caller asks for, and alongside the parent's own columns.
    expect(this.dialect.sort(Item, { tax: { name: 1, percentage: -1 }, code: -1 }, { tax: true })).toEqual({
      'tax.name': 1,
      'tax.percentage': -1,
      code: -1,
    });
  }

  /**
   * Ordering by a relation `$populate` did not ask for adds the `$lookup` itself, as the SQL dialects
   * add the join. A lookup does put a field on the document where a join is invisible, so the stage
   * that brought it in is followed by the `$unset` that takes it back out - the caller gets the rows
   * it asked for, in the order it asked for.
   */
  shouldSortByAnUnpopulatedRelation() {
    expect(this.dialect.sort(Item, { tax: { name: 1 } })).toEqual({ 'tax.name': 1 });

    const pipeline = this.dialect.aggregationPipeline(Item, { $sort: { tax: { name: 1 } } });
    expect(pipeline.map((stage) => Object.keys(stage)[0])).toEqual(['$lookup', '$unwind', '$sort', '$unset']);
    expect(pipeline.at(-1)).toEqual({ $unset: ['tax'] });
  }

  /**
   * The grouping keeps only the columns it projects, so an ordering reading a lookup they do not
   * carry has nothing left to read. Refused in the same terms `SELECT DISTINCT` refuses it.
   */
  shouldRejectDistinctSortedByAnUnpopulatedRelation() {
    expect(() =>
      this.dialect.aggregationPipeline(Item, {
        $select: { name: true },
        $distinct: true,
        $sort: { tax: { name: 1 } },
      }),
    ).toThrow("cannot $sort by relation 'tax' with $distinct unless 'tax' is populated");
  }

  /** A relation `$populate` asked for stays on the document; only the ordering's own lookups are undone. */
  shouldKeepAPopulatedRelationItAlsoSortsBy() {
    const pipeline = this.dialect.aggregationPipeline(Item, {
      $populate: { tax: true },
      $sort: { tax: { name: 1 } },
    });
    expect(pipeline.some((stage) => '$unset' in stage)).toBe(false);
  }

  shouldThrowOnUnjoinableRelationInSort() {
    // @ts-expect-error: a to-many sorts by `$count` alone
    expect(() => this.dialect.sort(Item, { tags: { name: 1 } }, { tags: true })).toThrow("cannot $sort by 'tags'");
    // Every level of the path gets its own lookup, so a nested ordering resolves without populating.
    expect(this.dialect.sort(Item, { tax: { category: { name: 1 } } })).toEqual({
      'tax.category.name': 1,
    });
    // Populating the whole path orders by the same nested alias the SQL dialects join to.
    expect(
      this.dialect.sort(
        Item,
        { tax: { category: { name: -1 } } },
        {
          tax: { $populate: { category: true } },
        },
      ),
    ).toEqual({ 'tax.category.name': -1 });
  }

  /** A `$lookup` for a to-one unwinds one document per parent, so it pages and orders no better than a join. */
  shouldRejectPagingALookedUpRelation() {
    // @ts-expect-error: a to-one takes no `$limit`
    expect(() => this.dialect.aggregationPipeline(Item, { $populate: { tax: { $limit: 5 } } })).toThrow(
      "'$limit' is not supported inside $populate of the to-one relation 'tax'",
    );
    expect(() =>
      // @ts-expect-error: a to-one takes no `$sort`
      this.dialect.aggregationPipeline(Item, { $populate: { tax: { $sort: { name: 1 } } } }),
    ).toThrow("'$sort' is not supported inside $populate of the to-one relation 'tax'");
  }

  /** An unknown path root is a typo (or an injected key) that would otherwise match nothing. */
  shouldThrowOnUnknownPathRoot() {
    // @ts-expect-error: no such field
    expect(() => this.dialect.where(Company, { 'nope.city': 'NY' })).toThrow('path nope.city does not exist in');
    // a declared JSON field may carry any embedded path
    expect(this.dialect.where(Company, { 'kind.country': 'NY' })).toEqual({ 'kind.country': 'NY' });
  }

  shouldBuildSort() {
    expect(this.dialect.sort(Item, {})).toEqual({});
    expect(this.dialect.sort(Item, { code: 1 })).toEqual({ code: 1 });
    expect(this.dialect.sort(Item, { code: -1 })).toEqual({ code: -1 });
    expect(this.dialect.sort(Item, { code: 1 })).toEqual({ code: 1 });
    expect(this.dialect.sort(Item, { code: -1 })).toEqual({ code: -1 });
    expect(this.dialect.sort(Item, { name: 1, createdAt: -1 })).toEqual({ name: 1, createdAt: -1 });
    expect(this.dialect.sort(Item, { name: -1, createdAt: -1 })).toEqual({ name: -1, createdAt: -1 });
  }

  shouldNormalizeIds() {
    const meta = getMeta(User);
    expect(this.dialect.normalizeIds(meta, [{ _id: 'abc' }, { _id: 'def' }])).toMatchObject([
      { id: 'abc' },
      { id: 'def' },
    ]);
    expect(this.dialect.normalizeId(meta, undefined)).toBe(undefined);
    expect(this.dialect.normalizeId(meta, { _id: 'abc', company: {}, users: [] })).toMatchObject({
      id: 'abc',
      company: {},
      users: [],
    });
  }

  shouldBuildAggregationPipeline() {
    expect(this.dialect.aggregationPipeline(Item, {})).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, { $where: {} })).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, {})).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, { $sort: { code: 1 } })).toEqual([{ $sort: { code: 1 } }]);

    // A to-many is a lookup of its own read, joined on the parent's key like a to-one.
    expect(this.dialect.aggregationPipeline(User, { $populate: { users: true } })).toEqual([
      { $lookup: { from: 'User', localField: '_id', foreignField: 'creatorId', as: 'users' } },
    ]);

    expect(
      this.dialect.aggregationPipeline(TaxCategory, {
        $populate: { creator: true },
        $where: { pk: '507f1f77bcf86cd799439011' },
        $sort: { creatorId: -1 },
      }),
      // One operator per stage: MongoDB rejects a stage object carrying both `$match` and `$sort`,
      // and the ordering runs before the lookups because it reads none of their fields.
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('507f1f77bcf86cd799439011'),
        },
      },
      {
        $sort: {
          creatorId: -1,
        },
      },
      {
        $lookup: {
          from: 'User',
          localField: 'creatorId',
          foreignField: '_id',
          as: 'creator',
        },
      },
      {
        $unwind: {
          path: '$creator',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    expect(
      this.dialect.aggregationPipeline(Item, {
        $populate: { measureUnit: true, tax: true },
        $where: { code: '123' },
      }),
    ).toEqual([
      {
        $match: {
          code: '123',
        },
      },
      {
        $lookup: {
          from: 'MeasureUnit',
          localField: 'measureUnitId',
          foreignField: '_id',
          pipeline: [{ $match: { deletedAt: null } }],
          as: 'measureUnit',
        },
      },
      {
        $unwind: { path: '$measureUnit', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: 'Tax',
          localField: 'taxId',
          foreignField: '_id',
          as: 'tax',
        },
      },
      {
        $unwind: { path: '$tax', preserveNullAndEmptyArrays: true },
      },
    ]);

    expect(
      this.dialect.aggregationPipeline(User, {
        $populate: { profile: true },
        $where: { id: '65496146f8f7899f63768df1' },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      // Nothing here is `$required`, so paging runs before the lookups.
      { $limit: 1 },
      {
        $lookup: {
          from: 'user_profile',
          localField: '_id',
          foreignField: 'creatorId',
          as: 'profile',
        },
      },
      {
        $unwind: {
          path: '$profile',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    expect(
      this.dialect.aggregationPipeline(User, {
        $populate: { profile: true },
        $where: { id: '65496146f8f7899f63768df1' },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      // Nothing here is `$required`, so paging runs before the lookups.
      { $limit: 1 },
      {
        $lookup: {
          from: 'user_profile',
          localField: '_id',
          foreignField: 'creatorId',
          as: 'profile',
        },
      },
      {
        $unwind: {
          path: '$profile',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    // Test referenceSort branch for 11 relation with $sort
    expect(
      this.dialect.aggregationPipeline(User, {
        $populate: { profile: true },
        $where: { id: '65496146f8f7899f63768df1' },
        $sort: { name: 1 },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      {
        $sort: {
          name: 1,
        },
      },
      { $limit: 1 },
      {
        $lookup: {
          from: 'user_profile',
          localField: '_id',
          foreignField: 'creatorId',
          as: 'profile',
        },
      },
      {
        $unwind: {
          path: '$profile',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);
  }

  /**
   * A `security: true` filter on a joined to-one applies to a bare `$populate`, with no `$where` of its
   * own, as it does on the SQL dialects.
   */
  shouldApplySecurityFilterToLookupPopulateWithoutExplicitWhere() {
    const pipeline = withContext({ secureTenantId: 5 }, () =>
      this.dialect.aggregationPipeline(SecureParent, {
        $select: { id: true },
        $populate: { related: { $select: { id: true, name: true } } },
      }),
    );
    expect(pipeline).toEqual([
      {
        $lookup: {
          from: 'SecureRelated',
          localField: 'relatedId',
          foreignField: '_id',
          // no `_id` key: MongoDB returns it by default, which is how the joined row keeps its id
          pipeline: [{ $match: { $and: [{ tenantId: 5 }] } }, { $project: { name: 1 } }],
          as: 'related',
        },
      },
      {
        $unwind: { path: '$related', preserveNullAndEmptyArrays: true },
      },
      {
        $project: { _id: 1, related: 1 },
      },
    ]);
  }

  /** Same shape as above, but with no ambient context: the security filter must fail closed. */
  shouldFailClosedForLookupPopulateWhenSecurityContextIsMissing() {
    expect(() =>
      this.dialect.aggregationPipeline(SecureParent, {
        $select: { id: true },
        $populate: { related: { $select: { id: true, name: true } } },
      }),
    ).toThrow(UqlSecurityError);
  }
  shouldTransformBetweenOperator() {
    const result = this.dialect.where(Item, { createdAt: { $between: [100, 200] } });
    expect(result).toEqual({
      createdAt: { $gte: 100, $lte: 200 },
    });
  }

  shouldTransformIsNullOperator() {
    expect(this.dialect.where(Item, { name: { $isNull: true } })).toEqual({
      name: { $eq: null },
    });
    expect(this.dialect.where(Item, { name: { $isNull: false } })).toEqual({
      name: { $ne: null },
    });
  }

  shouldTransformIsNotNullOperator() {
    expect(this.dialect.where(Item, { name: { $isNotNull: true } })).toEqual({
      name: { $ne: null },
    });
    expect(this.dialect.where(Item, { name: { $isNotNull: false } })).toEqual({
      name: { $eq: null },
    });
  }

  shouldPassThroughAllOperator() {
    expect(this.dialect.where(JsonRecord, { entries: { $all: ['a', 'b', 'c'] } })).toEqual({
      entries: { $all: ['a', 'b', 'c'] },
    });
  }

  shouldPassThroughSizeOperator() {
    expect(this.dialect.where(JsonRecord, { entries: { $size: 3 } })).toEqual({ entries: { $size: 3 } });
  }

  shouldMatchAnElementByWhatItHolds() {
    expect(
      this.dialect.where(JsonRecord, {
        entries: { $elemMatch: { tags: ['a'], meta: { size: 1 }, price: { $gt: 1 } } },
      }),
    ).toEqual({ entries: { $elemMatch: { tags: { $all: ['a'] }, 'meta.size': 1, price: { $gt: 1 } } } });
    expect(this.dialect.where(JsonRecord, { entries: { $all: ['a', { name: 'b', tags: ['x'] }] } })).toEqual({
      entries: { $all: [{ $elemMatch: { $eq: 'a' } }, { $elemMatch: { name: 'b', tags: { $all: ['x'] } } }] },
    });
    expect(this.dialect.where(JsonRecord, { entries: { $all: [[1, 2]] } })).toEqual({
      entries: { $all: [{ $elemMatch: { $all: [{ $elemMatch: { $eq: 1 } }, { $elemMatch: { $eq: 2 } }] } }] },
    });
  }

  shouldPassThroughElemMatchOperator() {
    expect(this.dialect.where(JsonRecord, { entries: { $elemMatch: { foo: 'bar' } } })).toEqual({
      entries: { $elemMatch: { foo: 'bar' } },
    });
  }

  shouldTransformStringOperatorsToRegex() {
    expect(this.dialect.where(Item, { name: { $startsWith: 'abc' } })).toEqual({
      name: { $regex: '^abc' },
    });
    expect(this.dialect.where(Item, { name: { $endsWith: 'xyz' } })).toEqual({
      name: { $regex: 'xyz$' },
    });
    expect(this.dialect.where(Item, { name: { $includes: 'test' } })).toEqual({
      name: { $regex: 'test' },
    });
    expect(this.dialect.where(Item, { name: { $like: '%test%' } })).toEqual({
      name: { $regex: '.*test.*' },
    });
    // Case-insensitive operators
    expect(this.dialect.where(Item, { name: { $istartsWith: 'abc' } })).toEqual({
      name: { $regex: '^abc', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $iendsWith: 'xyz' } })).toEqual({
      name: { $regex: 'xyz$', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $iincludes: 'test' } })).toEqual({
      name: { $regex: 'test', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $iincludes: 'data' } })).toEqual({
      name: { $regex: 'data', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $includes: 'val' } })).toEqual({
      name: { $regex: 'val' },
    });
    expect(this.dialect.where(Item, { name: { $ilike: '%test%' } })).toEqual({
      name: { $regex: '.*test.*', $options: 'i' },
    });
  }

  shouldNotResolveStringOperatorViaThePrototypeChain() {
    // @ts-expect-error: an inherited property, beside a real operator so the map is read as operators
    expect(this.dialect.where(Item, { name: { $gt: 'a', toString: 'x' } })).toEqual({
      name: { $gt: 'a', toString: 'x' },
    });
  }

  shouldNotResolveAggregateOperatorViaThePrototypeChain() {
    expect(() =>
      // @ts-expect-error: an inherited property, not an aggregate function
      this.dialect.buildAggregateStages(Item, { $select: { total: { toString: 'salePrice' } } }),
    ).toThrow('unsupported aggregate operator: toString');
  }

  shouldBuildAggregateStagesBasicCount() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
    });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $project: { _id: 0, count: 1 } }]);
  }

  /**
   * A group key reaches a to-one relation's field through its lookup, unwound keeping a row with no match,
   * and an aggregate's own `$where` is the expression a `$cond` tests.
   */
  shouldBuildAggregateStagesAcrossARelationFilteringEachAggregate() {
    const isNull = (ref: string) => ({ $eq: [{ $ifNull: [ref, null] }, null] });
    const sold = {
      $and: [{ $eq: ['$code', 'a'] }, { $and: [{ $not: [isNull('$salePrice')] }, { $lt: ['$salePrice', 5] }] }],
    };
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { taxName: { tax: { name: true } } },
      $select: {
        sold: { $sum: { salePrice: true }, $where: { code: 'a', salePrice: { $lt: 5 } } },
        n: { $count: '*', $where: { $or: [{ code: 'b' }, { code: null }] } },
      },
    });
    expect(stages).toEqual([
      { $lookup: { from: 'Tax', localField: 'taxId', foreignField: '_id', as: 'tax' } },
      { $unwind: { path: '$tax', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: { taxName: '$tax.name' },
          sold: { $sum: { $cond: [sold, '$salePrice', null] } },
          _uql_count_sold: { $sum: { $cond: [sold, { $cond: [isNull('$salePrice'), 0, 1] }, 0] } },
          n: { $sum: { $cond: [{ $or: [{ $eq: ['$code', 'b'] }, isNull('$code')] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          taxName: '$_id.taxName',
          sold: { $cond: [{ $eq: ['$_uql_count_sold', 0] }, null, '$sold'] },
          n: 1,
        },
      },
    ]);
  }

  /** A filter on the relation the group path joins runs inside that `$lookup`, not in a second one. */
  shouldFilterAGroupedRelationInsideItsLookup() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $where: { tax: { name: 'vat' } },
      $group: { taxName: { tax: { name: true } } },
      $select: { n: { $count: '*' } },
    });
    expect(stages.slice(0, 2)).toEqual([
      {
        $lookup: {
          from: 'Tax',
          localField: 'taxId',
          foreignField: '_id',
          pipeline: [{ $match: { name: 'vat' } }],
          as: 'tax',
        },
      },
      { $unwind: { path: '$tax', preserveNullAndEmptyArrays: false } },
    ]);
  }

  /**
   * Each comparison an aggregate's own `$where` takes, as the expression a `$cond` tests. A null or
   * missing field compares below every value there, so an upper bound asks for one to be present.
   */
  shouldTranslateAnAggregateFilterIntoAnExpression() {
    const counting = (where: QueryWhere<Item, QueryRaw, FieldKey<Item>>) =>
      this.dialect.buildAggregateStages(Item, { $select: { n: { $count: '*', $where: where } } })[0];
    const counted = (test: unknown) => ({ $group: { _id: null, n: { $sum: { $cond: [test, 1, 0] } } } });
    const isNull = (ref: string) => ({ $eq: [{ $ifNull: [ref, null] }, null] });
    const present = (ref: string) => ({ $not: [isNull(ref)] });

    expect(counting({ code: { $ne: 'a' } })).toEqual(counted({ $not: [{ $eq: ['$code', 'a'] }] }));
    expect(counting({ code: { $ne: null } })).toEqual(counted({ $not: [isNull('$code')] }));
    expect(counting({ salePrice: { $gte: 1, $lt: 9 } })).toEqual(
      counted({ $and: [{ $gte: ['$salePrice', 1] }, { $and: [present('$salePrice'), { $lt: ['$salePrice', 9] }] }] }),
    );
    expect(counting({ salePrice: { $between: [1, 9] } })).toEqual(
      counted({ $and: [{ $gte: ['$salePrice', 1] }, { $lte: ['$salePrice', 9] }] }),
    );
    expect(counting({ code: ['a', 'b'] })).toEqual(counted({ $in: ['$code', ['a', 'b']] }));
    expect(counting({ code: { $in: ['a'], $nin: ['b'] } })).toEqual(
      counted({ $and: [{ $in: ['$code', ['a']] }, { $not: [{ $in: ['$code', ['b']] }] }] }),
    );
    expect(counting({ code: { $isNull: true } })).toEqual(counted(isNull('$code')));
    expect(counting({ code: { $isNull: false } })).toEqual(counted(present('$code')));
    expect(counting({ code: { $isNotNull: true } })).toEqual(counted(present('$code')));
    expect(counting({ code: { $isNotNull: false } })).toEqual(counted(isNull('$code')));
    expect(counting({ $not: [{ code: 'a' }], $nor: [{ code: 'b' }, { code: 'c' }] })).toEqual(
      counted({
        $and: [
          { $not: [{ $and: [{ $eq: ['$code', 'a'] }] }] },
          { $not: [{ $or: [{ $eq: ['$code', 'b'] }, { $eq: ['$code', 'c'] }] }] },
        ],
      }),
    );
    // A key holds an `ObjectId` on the document, so its hex spelling is converted as a query's is.
    const taxId = '65f0c0ffee0000000000abcd';
    expect(counting({ taxId })).toEqual(counted({ $eq: ['$taxId', new ObjectId(taxId)] }));
  }

  /** An aggregate's own `$where` translates the comparisons, and refuses by name what an expression has none of. */
  shouldRefuseAnAggregateFilterItCannotTranslate() {
    expect(() =>
      this.dialect.buildAggregateStages(Item, {
        $select: { n: { $count: '*', $where: { $text: { $fields: { name: true }, $value: 'a' } } } },
      }),
    ).toThrow("aggregate $where operator '$text' is not supported on MongoDB");
    expect(() =>
      this.dialect.buildAggregateStages(Item, { $select: { n: { $count: '*', $where: { $or: [raw`1 = 1`] } } } }),
    ).toThrow('raw SQL is not supported in an aggregate $where on MongoDB');
    expect(() =>
      this.dialect.buildAggregateStages(MeasureUnit, { $group: { units: { category: { unitCount: true } } } }),
    ).toThrow("cannot $group by 'category.unitCount' on MongoDB: a joined row's relation aggregate is not read");
    expect(() =>
      this.dialect.buildAggregateStages(Item, {
        $select: { n: { $count: '*', $where: { name: { $startsWith: 'a' } } } },
      }),
    ).toThrow("aggregate $where operator '$startsWith' is not supported on MongoDB");
  }

  /** A relation aggregate the statement names is on the document before `$group` reads it. */
  shouldBuildAggregateStagesOverARelationAggregate() {
    const stages = this.dialect.buildAggregateStages(MeasureUnitCategory, {
      $group: { unitCount: true },
      $select: { n: { $count: '*' } },
    });
    expect(stages[0]).toHaveProperty('$lookup');
    expect(stages.slice(-2)).toEqual([
      { $group: { _id: { unitCount: '$unitCount' }, n: { $sum: 1 } } },
      { $project: { _id: 0, unitCount: '$_id.unitCount', n: 1 } },
    ]);
  }

  /**
   * A `$having` value that is not an operator map is a value to compare against, exactly as on the
   * SQL side. Keeping only numbers and objects dropped a string or boolean without a word, so the
   * caller got every group back instead of the filtered ones.
   */
  shouldBuildAggregate$havingByBareValue() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { n: { $count: '*' } },
      $having: { code: 'abc' },
    });
    expect(stages.at(-1)).toEqual({ $match: { code: 'abc' } });

    const byList = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { n: { $count: '*' } },
      $having: { code: ['a', 'b'] },
    });
    expect(byList.at(-1)).toEqual({ $match: { code: { $in: ['a', 'b'] } } });
  }

  shouldThrowOnEmptyAggregate() {
    expect(() => this.dialect.buildAggregateStages(Item, {})).toThrow(
      'aggregate requires at least one $group column or $select function',
    );
  }

  shouldBuildAggregateStagesGroupByWithAccumulators() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: {
        total: { $sum: { salePrice: true } },
        avg: { $avg: { salePrice: true } },
        min: { $min: { salePrice: true } },
        max: { $max: { salePrice: true } },
      },
    });
    // `$sum` answers 0 over no values where SQL answers null, so a count of what it read decides.
    const isNull = { $eq: [{ $ifNull: ['$salePrice', null] }, null] };
    expect(stages).toEqual([
      {
        $group: {
          _id: { code: '$code' },
          total: { $sum: '$salePrice' },
          _uql_count_total: { $sum: { $cond: [isNull, 0, 1] } },
          avg: { $avg: '$salePrice' },
          min: { $min: '$salePrice' },
          max: { $max: '$salePrice' },
        },
      },
      {
        $project: {
          _id: 0,
          code: '$_id.code',
          total: { $cond: [{ $eq: ['$_uql_count_total', 0] }, null, '$total'] },
          avg: 1,
          min: 1,
          max: 1,
        },
      },
    ]);
  }

  shouldBuildAggregateStagesCountDistinct() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { total: { $count: '*' }, distinctNames: { $countDistinct: { name: true } } },
    });
    expect(stages).toEqual([
      {
        $group: {
          _id: { code: '$code' },
          total: { $sum: 1 },
          distinctNames: { $addToSet: '$name' },
        },
      },
      {
        $project: {
          _id: 0,
          code: '$_id.code',
          total: 1,
          distinctNames: { $size: '$distinctNames' },
        },
      },
    ]);
  }

  shouldBuildAggregateStagesCountDistinctWithoutGroupKey() {
    // A grand-total distinct count still needs the $project to reduce the set to its size.
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { distinctNames: { $countDistinct: { name: true } } },
    });
    expect(stages).toEqual([
      { $group: { _id: null, distinctNames: { $addToSet: '$name' } } },
      { $project: { _id: 0, distinctNames: { $size: '$distinctNames' } } },
    ]);
  }

  shouldBuildAggregateStagesCountField() {
    // COUNT(field) counts non-null values (matching SQL), unlike COUNT(*) which counts every row, and
    // a missing field is as null as a null one, which an expression tells apart.
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { named: { $count: { name: true } } },
    });
    const isNull = { $eq: [{ $ifNull: ['$name', null] }, null] };
    expect(stages).toEqual([
      { $group: { _id: { code: '$code' }, named: { $sum: { $cond: [isNull, 0, 1] } } } },
      { $project: { _id: 0, code: '$_id.code', named: 1 } },
    ]);
  }

  shouldBuildAggregateStagesWithWhere() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $where: { code: '123' },
    });
    expect(stages).toEqual([
      { $match: { code: '123' } },
      { $group: { _id: null, count: { $sum: 1 } } },
      { $project: { _id: 0, count: 1 } },
    ]);
  }

  shouldBuildAggregateStagesWithHavingNumber() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { count: { $count: '*' } },
      $having: { count: 5 },
    });
    expect(stages).toEqual([
      {
        $group: {
          _id: { code: '$code' },
          count: { $sum: 1 },
        },
      },
      {
        $project: { _id: 0, code: '$_id.code', count: 1 },
      },
      {
        $match: { count: 5 },
      },
    ]);
  }

  shouldBuildAggregateStagesWithHavingOperator() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $having: { count: { $gte: 3 } },
    });
    expect(stages).toEqual([
      { $group: { _id: null, count: { $sum: 1 } } },
      { $project: { _id: 0, count: 1 } },
      { $match: { count: { $gte: 3 } } },
    ]);
  }

  shouldBuildAggregateStagesWithHavingUndefined() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $having: { count: undefined },
    });
    // undefined conditions are skipped, so no HAVING $match stage
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $project: { _id: 0, count: 1 } }]);
  }

  shouldBuildAggregateStagesWithSort() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $sort: { count: -1 },
    });
    expect(stages).toEqual([
      { $group: { _id: null, count: { $sum: 1 } } },
      { $project: { _id: 0, count: 1 } },
      { $sort: { count: -1 } },
    ]);
  }

  shouldBuildAggregateStagesWithEmptySort() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $sort: {},
    });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $project: { _id: 0, count: 1 } }]);
  }

  shouldBuildAggregateStagesWithAnEmptyWhere() {
    const stages = this.dialect.buildAggregateStages(Item, { $select: { count: { $count: '*' } }, $where: {} });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $project: { _id: 0, count: 1 } }]);
  }

  /** A key declared by a type name, not a class, reads as that name in the refusal. */
  shouldRefuseToMintAKeyDeclaredByTypeName() {
    @Entity()
    class BigKeyed {
      @Id({ type: 'bigint' }) id?: bigint;
      @Field({ type: String }) title?: string | null;
    }
    expect(() => this.dialect.getPersistables(getMeta(BigKeyed), { title: 't' }, 'onInsert')).toThrow(
      "'BigKeyed.id' is declared 'bigint' and left to the database",
    );
  }

  /** Nothing projected is every column, key included, so a `$distinct` over it has nothing to collapse. */
  shouldGroupNothingForADistinctThatProjectsNoColumn() {
    expect(this.dialect.aggregationPipeline(Item, { $distinct: true })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ $group: expect.anything() })]),
    );
  }

  shouldRejectARowLock() {
    expect(() => this.dialect.assertNoLock({ $lock: true })).toThrow(
      '$lock (row-level locking) is not supported on MongoDB',
    );
  }

  /** `false` takes no lock, so a query built conditionally runs here as it does on SQLite. */
  shouldAcceptALockOfFalse() {
    expect(() => this.dialect.assertNoLock({ $lock: false })).not.toThrow();
  }

  shouldReadAnUndefinedGroupOperatorAsConstrainingNoRelation() {
    expect(this.dialect.constrainsRelations(Item, { $and: undefined })).toBe(false);
  }

  /** A `$lookup` brings a relation in one row at a time, so there is nothing under it to rank by distance. */
  shouldRejectAVectorSortUnderARelation() {
    @Entity()
    class Shelf {
      @Id({ type: String }) id?: string;
      @Field({ references: () => VectorItem }) vectorItemId?: number | null;
      @ManyToOne({ entity: () => VectorItem, references: (shelf) => shelf.vectorItemId }) vectorItem?: VectorItem;
    }
    expect(() =>
      this.dialect.aggregationPipeline(Shelf, {
        $populate: { vectorItem: true },
        // @ts-expect-error: a relation sorts by no vector
        $sort: { vectorItem: { vec: { $vector: [1, 2, 3] } } },
      }),
    ).toThrow("$vector sort is only supported on the queried entity, not on relation 'vectorItem'");
  }

  /** The tally rides on a field only the queried entity's own pipeline adds, so a nested one is refused. */
  shouldRejectACountSortUnderARelation() {
    expect(() =>
      this.dialect.aggregationPipeline(ItemAdjustment, {
        $populate: { item: true },
        $sort: { item: { tags: { $count: -1 } } },
      }),
    ).toThrow("$sort by 'item.tags.$count' is only supported on the queried entity");
  }

  /** A key MongoDB itself names `_id` stays `_id`: there is no second name to move it to. */
  shouldKeepAKeyThatIsAlreadyNamedId() {
    @Entity()
    class RawDoc {
      @Id({ type: String }) _id?: string;
      @Field({ type: String }) title?: string | null;
    }
    expect(this.dialect.normalizeId(getMeta(RawDoc), { _id: 'x', title: 't' })).toEqual({ _id: 'x', title: 't' });
  }

  shouldRejectAnAggregateHavingOrSortOnAColumnItDoesNotEmit() {
    const cause = 'it is neither a $group column nor a $select alias';
    expect(() =>
      this.dialect.buildAggregateStages(Item, {
        $select: { count: { $count: '*' } },
        // @ts-expect-error: a misspelt alias
        $having: { conut: 1 },
      }),
    ).toThrow(`cannot $having by 'conut': ${cause}`);
    expect(() =>
      this.dialect.buildAggregateStages(Item, {
        $select: { count: { $count: '*' } },
        // @ts-expect-error: a misspelt alias
        $sort: { conut: 1 },
      }),
    ).toThrow(`cannot $sort by 'conut': ${cause}`);
  }

  shouldBuildAggregateStagesWithSkipAndLimit() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $skip: 10,
      $limit: 5,
    });
    expect(stages).toEqual([
      { $group: { _id: null, count: { $sum: 1 } } },
      { $project: { _id: 0, count: 1 } },
      { $skip: 10 },
      { $limit: 5 },
    ]);
  }

  shouldBuildAggregateStagesFullPipeline() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { count: { $count: '*' } },
      $where: { code: { $ne: '' } },
      $having: { count: { $gt: 1 } },
      $sort: { count: -1 },
      $skip: 0,
      $limit: 10,
    });
    expect(stages).toEqual([
      { $match: { code: { $ne: '' } } },
      {
        $group: {
          _id: { code: '$code' },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, code: '$_id.code', count: 1 } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $skip: 0 },
      { $limit: 10 },
    ]);
  }

  shouldBuildAggregateStagesNormalizeStringSortDescToNumeric() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $select: { count: { $count: '*' } },
      $sort: { count: 'desc' },
    });
    const sortStage = stages.find((s) => '$sort' in s);
    expect(sortStage).toEqual({ $sort: { count: -1 } });
  }

  shouldBuildAggregateStagesNormalizeStringSortAscToNumeric() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $select: { count: { $count: '*' } },
      $sort: { code: 'asc', count: 'desc' },
    });
    const sortStage = stages.find((s) => '$sort' in s);
    expect(sortStage).toEqual({ $sort: { code: 1, count: -1 } });
  }
  shouldBuildBasicVectorSearchStage() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(VectorItem, 'vec', { $vector: [1, 2, 3] }, undefined, 10);
    expect(result).toEqual({
      $vectorSearch: {
        index: 'vec_index',
        path: 'vec',
        queryVector: [1, 2, 3],
        numCandidates: 100,
        limit: 10,
      },
    });
  }

  /** `$sort` keys reach here from dynamic query data, so an unknown one has to be named, not ignored. */
  shouldRejectVectorSearchOnUnknownField() {
    @Entity({ name: 'VectorUnknown' })
    class VectorUnknown {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    expect(() =>
      this.dialect.buildVectorSearchStage(VectorUnknown, 'nope', { $vector: [1, 2, 3] }, undefined, 10),
    ).toThrow("Field 'nope' not found in entity 'VectorUnknown'");
  }

  shouldDeriveNumCandidatesFromLimit() {
    @Entity({ name: 'VectorNum' })
    class VectorNum {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const r5 = this.dialect.buildVectorSearchStage(VectorNum, 'vec', { $vector: [1, 2, 3] }, undefined, 5);
    expect(r5).toMatchObject({ $vectorSearch: { numCandidates: 50 } });
    const r20 = this.dialect.buildVectorSearchStage(VectorNum, 'vec', { $vector: [1, 2, 3] }, undefined, 20);
    expect(r20).toMatchObject({ $vectorSearch: { numCandidates: 200 } });
  }

  /** Atlas rejects a `numCandidates` above 10000, which `limit * 10` reaches at a limit of 1001. */
  shouldCapNumCandidatesAtTheAtlasMaximum() {
    @Entity({ name: 'VectorCap' })
    class VectorCap {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const stage = this.dialect.buildVectorSearchStage(VectorCap, 'vec', { $vector: [1, 2, 3] }, undefined, 5000);
    expect(stage).toMatchObject({ $vectorSearch: { numCandidates: 10_000 } });
  }

  /** Atlas requires `limit`, so a vector search without one is refused rather than sent without it. */
  shouldRejectVectorSearchWithoutALimit() {
    @Entity({ name: 'VectorNoLimit' })
    class VectorNoLimit {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    expect(() =>
      this.dialect.buildVectorSearchStage(VectorNoLimit, 'vec', { $vector: [1, 2, 3] }, undefined, 0),
    ).toThrow("$vectorSearch requires $limit (vector sort on 'vec' of 'VectorNoLimit')");
  }

  /**
   * MongoDB's `$text` takes only the search string: its text index declares the fields it covers, so
   * `$fields` cannot narrow it.
   */
  shouldTranslateTextSearchToMongoTextOperator() {
    const filter = this.dialect.where(Item, {
      $text: { $fields: { name: true, description: true }, $value: 'some text' },
    });
    expect(filter).toEqual({ $text: { $search: 'some text' } });
  }

  shouldPreFilterVectorSearch() {
    @Entity({ name: 'VectorItem2' })
    class VectorItem2 {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) category!: string | null;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(
      VectorItem2,
      'vec',
      { $vector: [1, 2, 3] },
      { category: 'science' },
      10,
    );
    expect(result).toEqual({
      $vectorSearch: {
        index: 'vec_index',
        path: 'vec',
        queryVector: [1, 2, 3],
        numCandidates: 100,
        limit: 10,
        filter: { category: 'science' },
      },
    });
  }

  shouldPreFilterWithComplexWhere() {
    @Entity({ name: 'VectorComplex' })
    class VectorComplex {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) category!: string | null;
      @Field({ type: String }) status!: string | null;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(
      VectorComplex,
      'vec',
      { $vector: [1, 2, 3] },
      { $or: [{ category: 'science' }, { status: 'published' }] },
      10,
    );
    expect(result).toEqual({
      $vectorSearch: {
        index: 'vec_index',
        path: 'vec',
        queryVector: [1, 2, 3],
        numCandidates: 100,
        limit: 10,
        filter: { $or: [{ category: 'science' }, { status: 'published' }] },
      },
    });
  }

  shouldNotAddFilterForEmptyWhere() {
    @Entity({ name: 'VectorItem3' })
    class VectorItem3 {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(VectorItem3, 'vec', { $vector: [1, 2, 3] }, {}, 10);
    expect(result).toEqual({
      $vectorSearch: {
        index: 'vec_index',
        path: 'vec',
        queryVector: [1, 2, 3],
        numCandidates: 100,
        limit: 10,
      },
    });
  }

  shouldProjectVectorSearchScore() {
    @Entity({ name: 'VectorProj' })
    class VectorProj {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(
      VectorProj,
      'vec',
      { $vector: [1, 2, 3], $project: 'similarity' },
      undefined,
      10,
    );
    // $project is not part of the $vectorSearch stage - it's handled in mongodbQuerier via $meta
    expect(result).toEqual({
      $vectorSearch: {
        index: 'vec_index',
        path: 'vec',
        queryVector: [1, 2, 3],
        numCandidates: 100,
        limit: 10,
      },
    });
  }

  shouldIgnoreDistanceMetricForMongo() {
    @Entity({ name: 'VectorDist' })
    class VectorDist {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(
      VectorDist,
      'vec',
      { $vector: [1, 2, 3], $distance: 'l2' },
      undefined,
      10,
    );
    // $distance is accepted but ignored - metric lives in Atlas index
    expect(result['$vectorSearch']).not.toHaveProperty('distance');
    expect(result['$vectorSearch']).not.toHaveProperty('similarity');
  }

  shouldUseCustomIndexName() {
    @Entity({ name: 'VectorCustomIdx' })
    @Index((vectorCustomIdx) => [vectorCustomIdx.vec], { type: 'vectorSearch', name: 'my_custom_idx' })
    class VectorCustomIdx {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[] | null;
    }
    const result = this.dialect.buildVectorSearchStage(VectorCustomIdx, 'vec', { $vector: [1, 2, 3] }, undefined, 10);
    expect(result).toMatchObject({ $vectorSearch: { index: 'my_custom_idx' } });
  }
  shouldExtractVectorSortFromMixed() {
    const result = this.dialect.extractVectorSort({
      vec: { $vector: [1, 2, 3] },
      name: -1,
      createdAt: 'desc',
    });
    expect(result).toBeDefined();
    expect(result?.vectorKey).toBe('vec');
    expect(result?.vectorSearch).toEqual({ $vector: [1, 2, 3] });
    expect(result?.regularSort).toEqual({ name: -1, createdAt: 'desc' });
  }

  shouldExtractVectorOnlySort() {
    const result = this.dialect.extractVectorSort({ vec: { $vector: [4, 5, 6] } });
    expect(result).toBeDefined();
    expect(result?.vectorKey).toBe('vec');
    expect(result?.vectorSearch).toEqual({ $vector: [4, 5, 6] });
    expect(result?.regularSort).toEqual({});
  }

  shouldReturnUndefinedForNonVectorSort() {
    expect(this.dialect.extractVectorSort({ name: -1, createdAt: 'desc' })).toBeUndefined();
  }

  shouldReturnUndefinedForUndefinedSort() {
    expect(this.dialect.extractVectorSort(undefined)).toBeUndefined();
  }
  shouldMapJsonOperatorsToNativeOperators() {
    expect(
      this.dialect.getUpdateFilter({
        name: 'plain',
        kind: { $set: { private: 1 }, $unset: ['public'], $push: { tags: 'x' } },
      }),
    ).toEqual({
      $set: { name: 'plain', 'kind.private': 1 },
      $push: { 'kind.tags': 'x' },
      $unset: { 'kind.public': '' },
    });
  }

  /** Disjoint paths stay on the cheaper single-document form. */
  shouldKeepUpdateDocumentWhenPathsAreDisjoint() {
    expect(this.dialect.getUpdateFilter({ kind: { $push: { tags: 'x' }, $unset: ['labels'] } })).toEqual({
      $push: { 'kind.tags': 'x' },
      $unset: { 'kind.labels': '' },
    });
  }

  /** Native `$pull` fails on a value that is no array, which the pipeline puts back as it is. */
  shouldUsePipelineForPull() {
    expect(this.dialect.getUpdateFilter({ kind: { $pull: { labels: 'y' } } })).toEqual([
      {
        $set: {
          'kind.labels': {
            $cond: [
              { $isArray: '$kind.labels' },
              { $filter: { input: { $ifNull: ['$kind.labels', []] }, cond: { $ne: ['$$this', { $literal: 'y' }] } } },
              '$kind.labels',
            ],
          },
        },
      },
    ]);
  }

  /** `$pull` filters the stored array, then `$push` appends to that result. */
  shouldUsePipelineForPullAndPushOnSamePath() {
    expect(this.dialect.getUpdateFilter({ kind: { $pull: { tags: 'old' }, $push: { tags: 'new' } } })).toEqual([
      {
        $set: {
          'kind.tags': {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$kind.tags', []] },
                  cond: { $ne: ['$$this', { $literal: 'old' }] },
                },
              },
              [{ $literal: 'new' }],
            ],
          },
        },
      },
    ]);
  }

  /** `$set` replaces the array outright, so the `$push` appends to the set value, not the stored one. */
  shouldUsePipelineForSetAndPushOnSamePath() {
    expect(this.dialect.getUpdateFilter({ kind: { $set: { tags: ['kept'] }, $push: { tags: 'appended' } } })).toEqual([
      {
        $set: {
          'kind.tags': { $concatArrays: [{ $literal: ['kept'] }, [{ $literal: 'appended' }]] },
        },
      },
    ]);
  }

  /**
   * A document has one `_id`, and a compound key under it is a sub-document whose field order decides
   * equality - a different document shape rather than a translation. Refused on both sides, or a write
   * would store the columns flat while every read looked for them under `_id`.
   */
  shouldRefuseACompositeKey() {
    @Entity()
    class Enrolment {
      [idKey]?: 'studentId' | 'courseId';
      @Id({ type: Number }) studentId?: number;
      @Id({ type: String }) courseId?: string;
      @Field({ type: String }) grade?: string | null;
    }
    const meta = getMeta(Enrolment);
    expect(() => this.dialect.columnOf(meta, 'studentId')).toThrow(
      /composite primary key \(studentId, courseId\), which MongoDB does not support/,
    );
    expect(() => this.dialect.getPersistables(meta, [{ studentId: 1, courseId: 'c' }], 'onInsert')).toThrow(
      /which MongoDB does not support/,
    );
    // A field that is not part of the key still resolves, so the refusal is about the key alone.
    expect(this.dialect.columnOf(meta, 'grade')).toBe('grade');
  }

  /**
   * The one path whose columns are never id columns, so `columnOf` never sees the key: a many-to-one
   * names its own foreign key on this side and `_id` on the other. Left to itself it joined the first
   * FK column against `_id` and gathered the rows of every key agreeing on that column.
   */
  shouldRefuseAJoinToACompositeTarget() {
    @Entity()
    class Enrolment {
      [idKey]?: 'studentId' | 'courseId';
      @Id({ type: Number }) studentId?: number;
      @Id({ type: String }) courseId?: string;
    }
    @Entity()
    class Attendance {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) enrolmentStudentId?: number | null;
      @Field({ type: String }) enrolmentCourseId?: string | null;
      @ManyToOne({
        entity: () => Enrolment,
        references: (attendance, enrolment) => [
          { local: attendance.enrolmentStudentId, foreign: enrolment.studentId },
          { local: attendance.enrolmentCourseId, foreign: enrolment.courseId },
        ],
      })
      enrolment?: Enrolment;
    }

    expect(() => this.dialect.aggregationPipeline(Attendance, { $where: { enrolment: { studentId: 1 } } })).toThrow(
      /composite primary key \(studentId, courseId\), which MongoDB does not support/,
    );
  }

  /** `$unset` is a later stage than `$set`, so it wins on a shared path - as it does in SQL. */
  shouldUsePipelineForSetAndUnsetOnSamePath() {
    expect(this.dialect.getUpdateFilter({ kind: { $set: { public: 1 }, $unset: ['public'] } })).toEqual([
      { $set: { 'kind.public': { $literal: 1 } } },
      { $unset: ['kind.public'] },
    ]);
  }

  /**
   * MongoDB mints one kind of key - an `ObjectId`, read back as its hex string - so a key declared
   * `Number` and left to the database is a promise it cannot keep. Refused rather than answered with
   * a string, which is what made `IdValue<E>` a lie on this backend. Prisma refuses the same shape.
   */
  shouldRefuseAKeyMongoDbCannotMint() {
    expect(() => this.dialect.getPersistables(getMeta(Invoice), [{ description: 'no key' }], 'onInsert')).toThrow(
      /'Invoice.id' is declared 'Number' and left to the database, which MongoDB cannot do/,
    );

    // Supplied, so there is nothing to mint - and a string key is what it can mint.
    expect(this.dialect.getPersistables(getMeta(Invoice), [{ id: 7, description: 'given' }], 'onInsert')).toEqual([
      { _id: 7, description: 'given' },
    ]);
    expect(this.dialect.getPersistables(getMeta(Doc), [{ title: 'minted' }], 'onInsert')).toEqual([
      { title: 'minted' },
    ]);
  }

  /**
   * The seam into the driver. A key, and any field that references one, becomes an `ObjectId` when
   * it is a valid 24-hex string, so a write agrees with the filter that will later look for it;
   * anything else is stored as given, which is how a `uuidv7` or a number key keeps its value.
   * The key maps to `_id` on an insert and is left out of an update, where `_id` is immutable.
   */
  shouldMapTheKeyAndReferencesIntoTheWire() {
    const meta = getMeta(Doc);
    const hex = '507f191e810c19729de860ea';

    expect(this.dialect.getPersistables(meta, [{ id: hex, parentId: hex, title: 'a' }], 'onInsert')).toEqual([
      { _id: new ObjectId(hex), parentId: new ObjectId(hex), title: 'a' },
    ]);
    expect(this.dialect.getPersistables(meta, [{ id: 'not-an-object-id', title: 'b' }], 'onInsert')).toEqual([
      { _id: 'not-an-object-id', title: 'b' },
    ]);
    expect(this.dialect.getPersistables(getMeta(Invoice), [{ id: 5100, description: 'c' }], 'onInsert')).toEqual([
      { _id: 5100, description: 'c' },
    ]);
    expect(this.dialect.getPersistables(meta, [{ id: hex, title: 'd' }], 'onUpdate')).toEqual([{ title: 'd' }]);

    expect(this.dialect.where(Doc, { parentId: hex })).toEqual({ parentId: new ObjectId(hex) });
    expect(this.dialect.where(Doc, { parentId: [hex, 'plain'] })).toEqual({
      parentId: { $in: [new ObjectId(hex), 'plain'] },
    });
  }

  /**
   * The seam out of the driver: an `ObjectId` in `_id` or a reference becomes its hex string, the
   * "string in your code" the docs promise, so `doc.id === someId` holds and a reference joins.
   */
  shouldHandBackHexStringsFromTheWire() {
    const meta = getMeta(Doc);
    const id = new ObjectId('507f191e810c19729de860ea');
    const parentId = new ObjectId('507f191e810c19729de860eb');

    expect(this.dialect.normalizeId(meta, { _id: id, parentId, title: 'a' })).toEqual({
      id: '507f191e810c19729de860ea',
      parentId: '507f191e810c19729de860eb',
      title: 'a',
    });
    expect(this.dialect.normalizeId(meta, { _id: 'kept-as-is', parentId: 7 })).toEqual({
      id: 'kept-as-is',
      parentId: 7,
    });
  }
}

createSpec(new MongoDialectSpec());
