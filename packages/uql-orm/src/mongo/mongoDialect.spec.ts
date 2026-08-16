import { ObjectId } from 'mongodb';
import { expect } from 'vitest';
import { UqlSecurityError, withContext } from '../context/context.js';
import { Entity, Field, Filter, getMeta, Id, Index, ManyToOne } from '../entity/index.js';
import { Company, createSpec, Item, MeasureUnitCategory, type Spec, Tax, TaxCategory, User } from '../test/index.js';
import { getRelationRequestSummary, raw } from '../util/index.js';
import { MongoDialect } from './mongoDialect.js';

declare module '../type/index.js' {
  interface UqlContext {
    secureTenantId?: number;
  }
}

/** The joined (m1) side of a `security: true` filter - the regression case for the $lookup/populate gap. */
@Filter('tenant', {
  condition: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
  security: true,
})
@Entity()
class SecureRelated {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number;
  @Field({ type: String })
  name?: string;
}

@Entity()
class SecureParent {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureRelated })
  relatedId?: number;
  @ManyToOne({ entity: () => SecureRelated })
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
  label?: string;
  @Field({ type: Date, name: 'deleted_at', softDelete: true })
  deletedAt?: Date;
}

class MongoDialectSpec implements Spec {
  dialect!: MongoDialect;

  beforeEach() {
    this.dialect = new MongoDialect();
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
        creatorId: 1,
        $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
        pk: '507f191e810c19729de860ea',
      }),
    ).toEqual({
      creatorId: 1,
      $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, '507f191e810c19729de860ea' as any)).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, { id: '507f191e810c19729de860ea' as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, { id: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, '507f191e810c19729de860ea')).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, { pk: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, { pk: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });
  }

  shouldSelect() {
    expect(this.dialect.select(Tax, { name: true })).toEqual({ name: 1 });
    // the primary key is stored as `_id`; `normalizeId` maps it back to `id` on the way out
    expect(this.dialect.select(Tax, { id: true, name: true })).toEqual({ _id: 1, name: 1 });
  }

  shouldThrowOnRawSelectArray() {
    expect(() => this.dialect.select(Tax, [raw('*')])).toThrow('raw $select is not supported on MongoDB');
  }

  /** Reads address the stored column, never the property key. */
  shouldAddressStoredColumnsForRenamedFields() {
    expect(this.dialect.select(RenamedDoc, { id: true, label: true })).toEqual({ _id: 1, the_label: 1 });
    expect(this.dialect.sort(RenamedDoc, { label: -1, id: 1 })).toEqual({ the_label: -1, _id: 1 });
    expect(this.dialect.where(RenamedDoc, { label: 'x' })).toEqual({ the_label: 'x', deleted_at: null });
    // group by the column, project back under the caller's key
    expect(this.dialect.buildAggregateStages(RenamedDoc, { $group: { label: true }, $agg: { n: { $count: '*' } } })) //
      .toEqual([
        { $group: { _id: { label: '$the_label' }, n: { $sum: 1 } } },
        { $project: { _id: 0, label: '$_id.label', n: 1 } },
      ]);
  }

  /** The built-in soft-delete filter reads the renamed column, so deletes must stamp that same one. */
  shouldFilterRenamedSoftDeleteColumn() {
    expect(this.dialect.where(RenamedDoc, {})).toEqual({ deleted_at: null });
  }

  /**
   * The inverse (11) side correlates per parent document. It used to build the lookup from the
   * query's own `_id`, so it only worked for a query filtered by primary key.
   */
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

  /** `$required` drops parents with no match - the aggregation equivalent of an INNER JOIN. */
  shouldDropUnmatchedParentsForRequiredPopulate() {
    const [, unwind] = this.dialect.aggregationPipeline(Item, { $populate: { tax: { $required: true } } });
    expect(unwind).toEqual({ $unwind: { path: '$tax', preserveNullAndEmptyArrays: false } });
  }

  /** `$exclude` of the primary key needs `_id: 0`: MongoDB returns `_id` unless told not to. */
  shouldExcludePrimaryKeyExplicitly() {
    expect(this.dialect.select(RenamedDoc, undefined, { id: true })).toEqual({ the_label: 1, deleted_at: 1, _id: 0 });
  }

  /** ...but a populated query keeps it anyway: the to-many fill groups children by the parent's. */
  shouldKeepThePrimaryKeyWhenPopulatingDespite$exclude() {
    const pipeline = this.dialect.aggregationPipeline(Item, {
      $exclude: { id: true },
      $populate: { tax: true },
    });
    const projections = pipeline.filter((stage) => stage.$project);
    expect(projections).toHaveLength(1);
    expect(projections[0].$project).not.toHaveProperty('_id');
    expect(projections[0].$project).toHaveProperty('tax', 1);
  }

  shouldThrowOnRawInWhere() {
    expect(() => this.dialect.where(Item, { $and: [raw('code IS NOT NULL')] })).toThrow(
      'raw() in $where is not supported on MongoDB',
    );
    expect(() => this.dialect.where(Item, { name: raw('lower(code)') as never })).toThrow(
      'raw() in $where is not supported on MongoDB',
    );
  }

  /**
   * A relation condition becomes one correlated `$lookup` into a temporary field plus a condition on
   * it. `$limit: 1` is enough for existence, and the target's own filters scope the lookup.
   */
  shouldFilterByOneToManyRelation() {
    expect(this.dialect.whereWithRelations(MeasureUnitCategory, { measureUnits: { name: 'kg' } })).toEqual({
      stages: [
        {
          $lookup: {
            from: 'MeasureUnit',
            localField: '_id',
            foreignField: 'categoryId',
            pipeline: [{ $match: { name: 'kg', deletedAt: null } }, { $limit: 1 }],
            as: '__uql_rel_0',
          },
        },
      ],
      filter: { '__uql_rel_0.0': { $exists: true }, deletedAt: null },
      unset: ['__uql_rel_0'],
    });
  }

  /** ManyToMany reaches the target from inside the junction's lookup, so no ids are materialized. */
  shouldFilterByManyToManyRelationThroughTheJunction() {
    const { stages, filter, unset } = this.dialect.whereWithRelations(Item, { tags: { name: 'urgent' } });
    expect(stages).toEqual([
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
                as: '__uql_target',
              },
            },
            { $match: { '__uql_target.0': { $exists: true } } },
            { $limit: 1 },
          ],
          as: '__uql_rel_0',
        },
      },
    ]);
    expect(filter).toEqual({ '__uql_rel_0.0': { $exists: true } });
    expect(unset).toEqual(['__uql_rel_0']);
  }

  /** `$size` counts inside the lookup; `$ifNull` makes an empty result compare as 0. */
  shouldCompareRelationSize() {
    const count = { $ifNull: [{ $arrayElemAt: ['$__uql_rel_0.n', 0] }, 0] };

    const exact = this.dialect.whereWithRelations(MeasureUnitCategory, { measureUnits: { $size: 0 } });
    expect(exact.stages[0]!.$lookup!.pipeline).toEqual([{ $match: { deletedAt: null } }, { $count: 'n' }]);
    expect(exact.filter).toEqual({ $expr: { $eq: [count, 0] }, deletedAt: null });

    const single = this.dialect.whereWithRelations(MeasureUnitCategory, { measureUnits: { $size: { $gte: 2 } } });
    expect(single.filter).toEqual({ $expr: { $gte: [count, 2] }, deletedAt: null });

    const between = this.dialect.whereWithRelations(MeasureUnitCategory, {
      measureUnits: { $size: { $between: [2, 5] } },
    });
    expect(between.filter).toEqual({
      $expr: { $and: [{ $gte: [count, 2] }, { $lte: [count, 5] }] },
      deletedAt: null,
    });

    const combined = this.dialect.whereWithRelations(MeasureUnitCategory, {
      measureUnits: { $size: { $gt: 1, $lt: 9 } },
    });
    expect(combined.filter).toEqual({
      $expr: { $and: [{ $gt: [count, 1] }, { $lt: [count, 9] }] },
      deletedAt: null,
    });
  }

  shouldThrowOnEmptyRelationSizeComparison() {
    expect(() =>
      this.dialect.whereWithRelations(MeasureUnitCategory, { measureUnits: { $size: { $gte: undefined } } }),
    ).toThrow('$size on a relation needs at least one comparison');
  }

  /**
   * The lookups are hoisted as pre-stages while the condition stays where the caller put it, so a
   * relation inside `$or` still means what it says.
   */
  shouldKeepRelationConditionInsideOr() {
    const { stages, filter } = this.dialect.whereWithRelations(MeasureUnitCategory, {
      $or: [{ name: 'weight' }, { measureUnits: { name: 'kg' } }],
    });
    expect(stages).toHaveLength(1);
    expect(filter).toEqual({
      $or: [{ name: 'weight' }, { '__uql_rel_0.0': { $exists: true } }],
      deletedAt: null,
    });
  }

  shouldReportWhetherAWhereConstrainsRelations() {
    expect(this.dialect.constrainsRelations(Item, undefined)).toBe(false);
    expect(this.dialect.constrainsRelations(Item, { name: 'x' })).toBe(false);
    expect(this.dialect.constrainsRelations(Item, { tags: { name: 'x' } } as never)).toBe(true);
    expect(this.dialect.constrainsRelations(Item, { $or: [{ tags: { name: 'x' } }] } as never)).toBe(true);
  }

  /** To-many relations are populated with a second query, so they contribute no `$lookup` stage. */
  shouldSkipToManyRelationsInLookupStages() {
    expect(this.dialect.relationStages(MeasureUnitCategory, { $populate: { measureUnits: true } })).toEqual([]);
  }

  /** A plain filter (`find`, `updateMany`) has nowhere to put the lookups a relation condition needs. */
  shouldThrowOnRelationInPlainFilter() {
    expect(() => this.dialect.where(Item, { tax: { name: 'VAT' } } as never)).toThrow(
      "filtering by relation 'tax' is not supported here on MongoDB",
    );
    expect(() => this.dialect.where(Item, { tags: { $size: 2 } } as never)).toThrow(
      "filtering by relation 'tags' is not supported here on MongoDB",
    );
  }

  /** A populated to-one is a field of the unwound document, so it sorts by its own column name. */
  shouldSortByRelationField() {
    expect(this.dialect.sort(Item, { tax: { name: -1 } } as never)).toEqual({ 'tax.name': -1 });
    expect(this.dialect.sort(User, { profile: { picture: 1 } } as never)).toEqual({ 'profile.image': 1 });
    // As many of its fields as the caller asks for, and alongside the parent's own columns.
    expect(this.dialect.sort(Item, { tax: { name: 1, percentage: -1 }, code: -1 } as never)).toEqual({
      'tax.name': 1,
      'tax.percentage': -1,
      code: -1,
    });
  }

  shouldThrowOnUnjoinableRelationInSort() {
    expect(() => this.dialect.sort(Item, { tags: { name: 1 } } as never)).toThrow("cannot $sort by 'tags'");
    expect(() => this.dialect.sort(Item, { tax: { category: { name: 1 } } } as never)).toThrow(
      "cannot $sort by 'tax.category' on MongoDB",
    );
  }

  /** A `$lookup` for a to-one unwinds one document per parent, so it pages and orders no better than a join. */
  shouldRejectPagingALookedUpRelation() {
    expect(() => this.dialect.aggregationPipeline(Item, { $populate: { tax: { $limit: 5 } } } as never)).toThrow(
      "'$limit' is not supported inside $populate of the to-one relation 'tax'",
    );
    expect(() =>
      this.dialect.aggregationPipeline(Item, { $populate: { tax: { $sort: { name: 1 } } } } as never),
    ).toThrow("'$sort' is not supported inside $populate of the to-one relation 'tax'");
  }

  /** An unknown path root is a typo (or an injected key) that would otherwise match nothing. */
  shouldThrowOnUnknownPathRoot() {
    expect(() => this.dialect.where(Company, { 'nope.city': 'NY' } as never)).toThrow(
      'path nope.city does not exist in',
    );
    // a declared JSON field may carry any embedded path
    expect(this.dialect.where(Company, { 'kind.city': 'NY' } as never)).toEqual({ 'kind.city': 'NY' });
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
    expect(
      this.dialect.normalizeIds(meta, [
        { _id: 'abc' } as Partial<User> as User,
        { _id: 'def' } as Partial<User> as User,
      ]),
    ).toMatchObject([{ id: 'abc' }, { id: 'def' }]);
    expect(this.dialect.normalizeIds(meta, undefined)).toBe(undefined);
    expect(this.dialect.normalizeId(meta, undefined)).toBe(undefined);
    expect(
      this.dialect.normalizeId(meta, { _id: 'abc', company: {}, users: [] } as Partial<User> as User),
    ).toMatchObject({
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

    expect(this.dialect.aggregationPipeline(User, { $populate: { users: true } })).toEqual([]);

    expect(
      this.dialect.aggregationPipeline(TaxCategory, {
        $populate: { creator: true },
        $where: { pk: '507f1f77bcf86cd799439011' },
        $sort: { creatorId: -1 },
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('507f1f77bcf86cd799439011'),
        },
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
        $where: '65496146f8f7899f63768df1' as any,
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      // `$limit` used to be dropped whenever a relation was populated; nothing here is `$required`,
      // so paging runs before the lookups
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
        $where: { id: '65496146f8f7899f63768df1' as any },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      // `$limit` used to be dropped whenever a relation was populated; nothing here is `$required`,
      // so paging runs before the lookups
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
        $where: { id: '65496146f8f7899f63768df1' as any },
        $sort: { name: 1 },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
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

  shouldMatchAggregationPipelineWithPrecomputedRelationSummary() {
    const meta = getMeta(User);
    const summary = getRelationRequestSummary(meta, { profile: true });
    const baseline = this.dialect.aggregationPipeline(User, { $populate: { profile: true } });
    expect(this.dialect.aggregationPipeline(User, { $populate: { profile: true } }, summary)).toEqual(baseline);
  }

  /**
   * Regression for the $lookup/populate gap: a `security: true` filter on a joined (m1) relation
   * must apply even to a bare `$populate: { related: true }` with no explicit `$where` on it -
   * matching the SQL dialects' equivalent JOIN-ON-clause fix.
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

  // New operator tests
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
    const result = this.dialect.where(Item, { name: { $all: ['a', 'b', 'c'] } } as any);
    expect(result).toEqual({
      name: { $all: ['a', 'b', 'c'] },
    });
  }

  shouldPassThroughSizeOperator() {
    const result = this.dialect.where(Item, { name: { $size: 3 } } as any);
    expect(result).toEqual({
      name: { $size: 3 },
    });
  }

  shouldPassThroughElemMatchOperator() {
    const result = this.dialect.where(Item, { name: { $elemMatch: { foo: 'bar' } } } as any);
    expect(result).toEqual({
      name: { $elemMatch: { foo: 'bar' } },
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
    // 'toString' only exists via Object.prototype, not REGEX_OP_MAP's own keys - alongside a real
    // operator ($gt) so the object still qualifies as an operator map (hasOperatorKeys) and reaches
    // transformOperators. Before the fix this crashed with "regexEntry.wrap is not a function".
    expect(this.dialect.where(Item, { name: { $gt: 'a', toString: 'x' } } as any)).toEqual({
      name: { $gt: 'a', toString: 'x' },
    });
  }

  shouldNotResolveAggregateOperatorViaThePrototypeChain() {
    expect(() =>
      this.dialect.buildAggregateStages(Item, { $agg: { total: { toString: 'salePrice' } } } as any),
    ).toThrow('unsupported aggregate operator: toString');
  }

  shouldTransformTextOperator() {
    expect(this.dialect.where(Item, { name: { $text: 'search' } } as any)).toEqual({
      name: { $text: { $search: 'search' } },
    });
  }

  shouldBuildAggregateStagesBasicCount() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $agg: { count: { $count: '*' } },
    });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }]);
  }

  shouldThrowOnEmptyAggregate() {
    expect(() => this.dialect.buildAggregateStages(Item, {})).toThrow(
      'aggregate requires at least one $group column or $agg function',
    );
  }

  shouldBuildAggregateStagesGroupByWithAccumulators() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: {
        total: { $sum: 'salePrice' },
        avg: { $avg: 'salePrice' },
        min: { $min: 'salePrice' },
        max: { $max: 'salePrice' },
      },
    });
    expect(stages).toEqual([
      {
        $group: {
          _id: { code: '$code' },
          total: { $sum: '$salePrice' },
          avg: { $avg: '$salePrice' },
          min: { $min: '$salePrice' },
          max: { $max: '$salePrice' },
        },
      },
      {
        $project: {
          _id: 0,
          code: '$_id.code',
          total: 1,
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
      $agg: { total: { $count: '*' }, distinctNames: { $countDistinct: 'name' } },
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
      $agg: { distinctNames: { $countDistinct: 'name' } },
    });
    expect(stages).toEqual([
      { $group: { _id: null, distinctNames: { $addToSet: '$name' } } },
      { $project: { _id: 0, distinctNames: { $size: '$distinctNames' } } },
    ]);
  }

  shouldBuildAggregateStagesSumDistinct() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: { distinctTotal: { $sumDistinct: 'salePrice' } },
    });
    expect(stages).toEqual([
      { $group: { _id: { code: '$code' }, distinctTotal: { $addToSet: '$salePrice' } } },
      { $project: { _id: 0, code: '$_id.code', distinctTotal: { $sum: '$distinctTotal' } } },
    ]);
  }

  shouldBuildAggregateStagesAvgDistinct() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: { distinctAverage: { $avgDistinct: 'salePrice' } },
    });
    expect(stages).toEqual([
      { $group: { _id: { code: '$code' }, distinctAverage: { $addToSet: '$salePrice' } } },
      { $project: { _id: 0, code: '$_id.code', distinctAverage: { $avg: '$distinctAverage' } } },
    ]);
  }

  shouldBuildAggregateStagesCountField() {
    // COUNT(field) counts non-null values (matching SQL), unlike COUNT(*) which counts every row.
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: { named: { $count: 'name' } },
    });
    expect(stages).toEqual([
      { $group: { _id: { code: '$code' }, named: { $sum: { $cond: [{ $ne: ['$name', null] }, 1, 0] } } } },
      { $project: { _id: 0, code: '$_id.code', named: 1 } },
    ]);
  }

  shouldBuildAggregateStagesWithWhere() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $agg: { count: { $count: '*' } },
      $where: { code: '123' },
    });
    expect(stages).toEqual([{ $match: { code: '123' } }, { $group: { _id: null, count: { $sum: 1 } } }]);
  }

  shouldBuildAggregateStagesWithHavingNumber() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: { count: { $count: '*' } },
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
      $agg: { count: { $count: '*' } },
      $having: { count: { $gte: 3 } },
    });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $match: { count: { $gte: 3 } } }]);
  }

  shouldBuildAggregateStagesWithHavingUndefined() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $agg: { count: { $count: '*' } },
      $having: { count: undefined },
    });
    // undefined conditions are skipped, so no HAVING $match stage
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }]);
  }

  shouldBuildAggregateStagesWithSort() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $agg: { count: { $count: '*' } },
      $sort: { count: -1 },
    });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
  }

  shouldBuildAggregateStagesWithSkipAndLimit() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $agg: { count: { $count: '*' } },
      $skip: 10,
      $limit: 5,
    });
    expect(stages).toEqual([{ $group: { _id: null, count: { $sum: 1 } } }, { $skip: 10 }, { $limit: 5 }]);
  }

  shouldBuildAggregateStagesFullPipeline() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: { count: { $count: '*' } },
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
      $agg: { count: { $count: '*' } },
      $sort: { count: 'desc' },
    });
    const sortStage = stages.find((s) => '$sort' in s);
    expect(sortStage).toEqual({ $sort: { count: -1 } });
  }

  shouldBuildAggregateStagesNormalizeStringSortAscToNumeric() {
    const stages = this.dialect.buildAggregateStages(Item, {
      $group: { code: true },
      $agg: { count: { $count: '*' } },
      $sort: { code: 'asc', count: 'desc' },
    });
    const sortStage = stages.find((s) => '$sort' in s);
    expect(sortStage).toEqual({ $sort: { code: 1, count: -1 } });
  }

  shouldMapTableNameRow() {
    expect((this.dialect as any).mapTableNameRow({ table_name: 'users' })).toBe('users');
  }
  // --- Vector Search ---

  shouldBuildBasicVectorSearchStage() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[];
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
      @Field({ type: 'vector' }) vec!: number[];
    }
    expect(() =>
      this.dialect.buildVectorSearchStage(VectorUnknown, 'nope', { $vector: [1, 2, 3] }, undefined, 10),
    ).toThrow("Field 'nope' not found in entity 'VectorUnknown'");
  }

  shouldDeriveNumCandidatesFromLimit() {
    @Entity({ name: 'VectorNum' })
    class VectorNum {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const r5 = this.dialect.buildVectorSearchStage(VectorNum, 'vec', { $vector: [1, 2, 3] }, undefined, 5);
    expect((r5['$vectorSearch'] as Record<string, unknown>)['numCandidates']).toBe(50);
    const r20 = this.dialect.buildVectorSearchStage(VectorNum, 'vec', { $vector: [1, 2, 3] }, undefined, 20);
    expect((r20['$vectorSearch'] as Record<string, unknown>)['numCandidates']).toBe(200);
  }

  /** Atlas rejects a `numCandidates` above 10000, which `limit * 10` reaches at a limit of 1001. */
  shouldCapNumCandidatesAtTheAtlasMaximum() {
    @Entity({ name: 'VectorCap' })
    class VectorCap {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const stage = this.dialect.buildVectorSearchStage(VectorCap, 'vec', { $vector: [1, 2, 3] }, undefined, 5000);
    expect((stage['$vectorSearch'] as Record<string, unknown>)['numCandidates']).toBe(10_000);
  }

  /** Atlas requires `limit`; without it the stage used to carry `numCandidates: null` and no limit. */
  shouldRejectVectorSearchWithoutALimit() {
    @Entity({ name: 'VectorNoLimit' })
    class VectorNoLimit {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    expect(() =>
      this.dialect.buildVectorSearchStage(VectorNoLimit, 'vec', { $vector: [1, 2, 3] }, undefined, 0),
    ).toThrow("$vectorSearch requires $limit (vector sort on 'vec' of 'VectorNoLimit')");
  }

  /**
   * MongoDB's own `$text` takes only the search string: its text index declares which fields it
   * covers, so `$fields` cannot narrow it. Before this, `$text` fell through to path validation and
   * failed with "path $text does not exist".
   */
  shouldTranslateTextSearchToMongoTextOperator() {
    const filter = this.dialect.where(Item, { $text: { $fields: ['name', 'description'], $value: 'some text' } });
    expect(filter).toEqual({ $text: { $search: 'some text' } });
  }

  shouldPreFilterVectorSearch() {
    @Entity({ name: 'VectorItem2' })
    class VectorItem2 {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) category!: string;
      @Field({ type: 'vector' }) vec!: number[];
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
      @Field({ type: String }) category!: string;
      @Field({ type: String }) status!: string;
      @Field({ type: 'vector' }) vec!: number[];
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
      @Field({ type: 'vector' }) vec!: number[];
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
      @Field({ type: 'vector' }) vec!: number[];
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
      @Field({ type: 'vector' }) vec!: number[];
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
    @Index(['vec'], { type: 'vectorSearch', name: 'my_custom_idx' })
    class VectorCustomIdx {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const result = this.dialect.buildVectorSearchStage(VectorCustomIdx, 'vec', { $vector: [1, 2, 3] }, undefined, 10);
    expect((result['$vectorSearch'] as Record<string, unknown>)['index']).toBe('my_custom_idx');
  }

  // --- extractVectorSort ---

  shouldExtractVectorSortFromMixed() {
    const result = this.dialect.extractVectorSort({
      vec: { $vector: [1, 2, 3] },
      name: -1,
      createdAt: 'desc',
    } as any);
    expect(result).toBeDefined();
    expect(result!.vectorKey).toBe('vec');
    expect(result!.vectorSearch).toEqual({ $vector: [1, 2, 3] });
    expect(result!.regularSort).toEqual({ name: -1, createdAt: 'desc' });
  }

  shouldExtractVectorOnlySort() {
    const result = this.dialect.extractVectorSort({ vec: { $vector: [4, 5, 6] } } as any);
    expect(result).toBeDefined();
    expect(result!.vectorKey).toBe('vec');
    expect(result!.vectorSearch).toEqual({ $vector: [4, 5, 6] });
    expect(result!.regularSort).toEqual({});
  }

  shouldReturnUndefinedForNonVectorSort() {
    expect(this.dialect.extractVectorSort({ name: -1, createdAt: 'desc' } as any)).toBeUndefined();
  }

  shouldReturnUndefinedForUndefinedSort() {
    expect(this.dialect.extractVectorSort(undefined)).toBeUndefined();
  }

  // ─── JSON update operators mapped onto native MongoDB operators ───────────

  shouldMapJsonOperatorsToNativeOperators() {
    expect(
      this.dialect.getUpdateFilter({
        name: 'plain',
        kind: { $set: { private: 1 }, $unset: ['public'], $push: { tags: 'x' }, $pull: { labels: 'y' } },
      }),
    ).toEqual({
      $set: { name: 'plain', 'kind.private': 1 },
      $push: { 'kind.tags': 'x' },
      $pull: { 'kind.labels': 'y' },
      $unset: { 'kind.public': '' },
    });
  }

  /** Disjoint paths stay on the cheaper single-document form. */
  shouldKeepUpdateDocumentWhenPathsAreDisjoint() {
    expect(this.dialect.getUpdateFilter({ kind: { $push: { tags: 'x' }, $pull: { labels: 'y' } } })).toEqual({
      $push: { 'kind.tags': 'x' },
      $pull: { 'kind.labels': 'y' },
    });
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

  /** `$unset` is a later stage than `$set`, so it wins on a shared path - as it does in SQL. */
  shouldUsePipelineForSetAndUnsetOnSamePath() {
    expect(this.dialect.getUpdateFilter({ kind: { $set: { public: 1 }, $unset: ['public'] } })).toEqual([
      { $set: { 'kind.public': { $literal: 1 } } },
      { $unset: ['kind.public'] },
    ]);
  }
}

createSpec(new MongoDialectSpec());
