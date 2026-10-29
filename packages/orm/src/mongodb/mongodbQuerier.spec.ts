import { AbstractCursor, ClientSession, Collection, type Document, MongoClient } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGGREGATE_VALUE_ALIAS } from '../dialect/aliases.js';
import { Computed, Entity, f, Field, ManyToOne } from '../entity/index.js';
import { assertDefined, Item } from '../test/index.js';
import { sql } from '../util/sql.js';
import { MongoDialect } from './mongoDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';
import { vectorDistanceExpr } from './vectorDistance.js';

@Entity({
  name: 'Article',
  indexes: (article, index) => [index([article.embedding], { type: 'vectorSearch', name: 'embedding_vs' })],
})
class Article {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.string().nullable()) category?: string | null;
  @Field(f.column('vector').nullable()) embedding?: number[] | null;
}

@Entity({ name: 'Author' })
class Author {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
}

@Entity({ name: 'Post' })
class Post {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Author).nullable()) authorId?: number | null;
  @ManyToOne({ entity: () => Author, references: (post) => post.authorId }) author?: Author;
  @Field(f.references(() => Author).nullable()) reviewerId?: number | null;
  @ManyToOne({ entity: () => Author, references: (post) => post.reviewerId }) reviewer?: Author;
}

/** A trigger and a stamp, neither of which MongoDB can run. */
@Entity({
  name: 'Triggered',
  triggers: (triggered, trigger) => [trigger({ on: 'afterInsert', run: (newRow) => sql`PERFORM ${newRow.id};` })],
})
class Triggered {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) body?: string | null;
}

@Entity({ name: 'Stamped' })
class Stamped {
  @Field(f.number().id()) id?: number;
  @Computed((row) =>
    f
      .date()
      .nullable()
      .as(sql`CURRENT_TIMESTAMP`)
      .stored(['update']),
  )
  readonly touchedAt?: Date | null;
}

/** Soft-deletable through a renamed column. */
@Entity({ name: 'SoftDoc' })
class SoftDoc {
  @Field(f.number().id()) id?: number;
  @Field(f.date().nullable().softDelete().name('deleted_at')) deletedAt?: Date | null;
}

/** A field under an Atlas index built for a metric other than the default. */
@Entity({
  name: 'RankedByInner',
  indexes: (rankedByInner, index) => [index([rankedByInner.embedding], { type: 'vectorSearch', distance: 'inner' })],
})
class RankedByInner {
  @Field(f.number().id()) id?: number;
  @Field(f.column('vector').nullable()) embedding?: number[] | null;
}

/** An entity that is both vector-searchable and has a relation, for the combined case. */
@Entity({
  name: 'Chunk',
  indexes: (chunk, index) => [index([chunk.embedding], { type: 'vectorSearch', name: 'chunk_vs' })],
})
class Chunk {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) text?: string | null;
  @Field(f.references(() => Author).nullable()) authorId?: number | null;
  @ManyToOne({ entity: () => Author, references: (chunk) => chunk.authorId }) author?: Author;
  @Field(f.column('vector').nullable()) embedding?: number[] | null;
}

/**
 * A querier over a client that never connects: every cursor answers `rows`, and the calls reaching a
 * collection are recorded. `$vectorSearch` runs on Atlas alone, which is why these pipelines are
 * asserted as sent rather than run.
 */
function createRecordingQuerier(rows: Document[] = []) {
  const querier = new MongodbQuerier(new MongoDialect(), new MongoClient('mongodb://127.0.0.1:1'));
  const aggregate = vi.spyOn(Collection.prototype, 'aggregate');
  const find = vi.spyOn(Collection.prototype, 'find');
  const toArray = vi.spyOn(AbstractCursor.prototype, 'toArray').mockResolvedValue(rows);
  const iterate = vi.spyOn(AbstractCursor.prototype, Symbol.asyncIterator).mockImplementation(async function* () {
    yield* rows;
  });
  return { querier, aggregate, find, toArray, iterate };
}

/** The pipeline of the `call`th aggregation a querier sent. */
function pipelineOf(calls: readonly (readonly [Document[]?, ...unknown[]])[], call = 0): Document[] {
  const [pipeline] = calls[call];
  assertDefined(pipeline);
  return pipeline;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The driver settles its own transaction state, so a commit it refused may leave none open to abort. */
describe('MongodbQuerier transactions', () => {
  it('should send no abort after a commit that ended the transaction it failed', async () => {
    const querier = new MongodbQuerier(new MongoDialect(), new MongoClient('mongodb://127.0.0.1:1'));
    let open = false;
    vi.spyOn(ClientSession.prototype, 'startTransaction').mockImplementation(() => {
      open = true;
    });
    vi.spyOn(ClientSession.prototype, 'inTransaction').mockImplementation(() => open);
    vi.spyOn(ClientSession.prototype, 'commitTransaction').mockImplementation(async () => {
      open = false;
      throw new Error('commit refused');
    });
    const abort = vi.spyOn(ClientSession.prototype, 'abortTransaction');

    await expect(querier.transaction(async () => {})).rejects.toThrow('commit refused');
    expect(abort).not.toHaveBeenCalled();
    await querier.release();
  });
});

// MongoDB runs no trigger within a write, so a write to an entity declaring one would silently skip it.
describe('MongodbQuerier writes to an entity with triggers', () => {
  it('should refuse an insert rather than skip the trigger', async () => {
    const { querier } = createRecordingQuerier();
    await expect(querier.insertOne(Triggered, { id: 1, body: 'a' })).rejects.toThrow(/'Triggered' declares triggers/);
  });

  it('should refuse an update, a delete and an upsert alike', async () => {
    const { querier } = createRecordingQuerier();
    await expect(querier.updateOneById(Triggered, 1, { body: 'b' })).rejects.toThrow(/declares triggers/);
    await expect(querier.deleteOneById(Triggered, 1)).rejects.toThrow(/declares triggers/);
    await expect(querier.upsertOne(Triggered, { $conflict: { id: true } }, { id: 1, body: 'c' })).rejects.toThrow(
      /declares triggers/,
    );
  });

  // Inserting first, a document another writer inserted meanwhile still takes the update, as `ON CONFLICT` gives it.
  it('should insert what is absent, then update only what it found, in two batches with no transaction of its own', async () => {
    const { querier } = createRecordingQuerier();
    let open = false;
    const start = vi.spyOn(ClientSession.prototype, 'startTransaction').mockImplementation(() => {
      open = true;
    });
    vi.spyOn(ClientSession.prototype, 'inTransaction').mockImplementation(() => open);
    const commit = vi.spyOn(ClientSession.prototype, 'commitTransaction').mockImplementation(async () => {
      open = false;
    });
    const bulkWrite = vi
      .spyOn(Collection.prototype, 'bulkWrite')
      .mockResolvedValueOnce({ upsertedIds: { 1: 2 }, insertedIds: {} } as never)
      .mockResolvedValueOnce({ upsertedIds: {}, insertedIds: {} } as never);

    await querier.upsertMany(Author, { $conflict: { id: true }, $where: { name: 'a' } }, [
      { id: 1, name: 'x' },
      { id: 2, name: 'y' },
      { id: 3, name: 'z' },
    ]);

    expect([start.mock.calls.length, commit.mock.calls.length]).toEqual([0, 0]);
    const [[inserts], [updates]] = bulkWrite.mock.calls;
    expect(inserts).toEqual(
      [1, 2, 3].map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $setOnInsert: expect.objectContaining({ _id: id }) },
          upsert: true,
        },
      })),
    );
    expect(updates).toEqual(
      [
        [1, 'x'],
        [3, 'z'],
      ].map(([id, name]) => ({
        updateOne: { filter: { _id: id, $and: [{ name: 'a' }] }, update: [{ $set: { name: { $literal: name } } }] },
      })),
    );
  });

  it('should refuse a write to an entity with a stamp, which is a trigger too', async () => {
    const { querier } = createRecordingQuerier();
    await expect(querier.insertOne(Stamped, { id: 1 })).rejects.toThrow(/'Stamped' declares triggers/);
  });
});

/**
 * Which of the two read paths a query takes: the cheap plain `find` cursor, or the aggregation
 * pipeline for the clauses a cursor cannot express. `$distinct` was missing from that list and got
 * dropped silently for want of this test. Both directions are pinned - the fast path staying fast
 * matters as much as an unexpressible clause reaching the pipeline.
 */
describe('MongodbQuerier counts', () => {
  /** A `$distinct` read counts through the pipeline, whose `$count` stage emits no row for no match. */
  it('should report a page and a total of zero where a pipeline read matches nothing', async () => {
    const { querier } = createRecordingQuerier();
    expect(await querier.findManyAndCount(Item, { $distinct: true })).toEqual([[], 0]);
  });

  /** The collection's metadata count, which takes no filter. */
  it('should read the estimated count off the collection', async () => {
    const { querier } = createRecordingQuerier();
    vi.spyOn(Collection.prototype, 'estimatedDocumentCount').mockResolvedValue(7);
    expect(await querier.estimatedCount(Item)).toBe(7);
  });
});

describe('MongodbQuerier read routing', () => {
  it('should serve a plain query from the find cursor', async () => {
    const { querier, aggregate, find } = createRecordingQuerier();
    await querier.findMany(Item, { $select: { name: true }, $where: { name: 'x' }, $limit: 2 });
    expect(find).toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('should send a clause the cursor cannot express to the pipeline', async () => {
    const { querier, aggregate, find } = createRecordingQuerier();
    await querier.findMany(Item, { $select: { name: true }, $distinct: true });
    expect(aggregate).toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});

describe('MongodbQuerier vector search', () => {
  it('should route vector sort through $vectorSearch pipeline', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    expect(aggregate).toHaveBeenCalled();
    expect(pipelineOf(aggregate.mock.calls)[0]).toMatchObject({
      $vectorSearch: { index: 'embedding_vs', queryVector: [1, 2, 3], limit: 10, numCandidates: 100 },
    });
  });

  it('should load relations under a vector sort, capturing the distance before the lookups', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Chunk, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $populate: { author: true },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline[0]).toHaveProperty('$vectorSearch');
    // `$addFields` rather than `$project`: projecting here would drop the join key and the joined doc
    expect(pipeline[1]).toEqual({ $addFields: { score: vectorDistanceExpr('embedding', [1, 2, 3], 'cosine') } });
    expect(pipeline[2]).toEqual({
      $lookup: { from: 'Author', localField: 'authorId', foreignField: '_id', as: '_uql_joined_author' },
    });
    expect(pipeline[3]).toEqual({ $unwind: { path: '$_uql_joined_author', preserveNullAndEmptyArrays: true } });
    expect(pipeline.some((stage) => '$project' in stage)).toBe(false);
  });

  it('should project after the lookups when a vector query narrows its columns', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Chunk, {
      $select: { text: true },
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $populate: { author: true },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    const unwindIndex = pipeline.findIndex((stage) => '$unwind' in stage);
    const projectIndex = pipeline.findIndex((stage) => '$project' in stage);
    expect(projectIndex).toBeGreaterThan(unwindIndex);
    expect(pipeline[projectIndex]).toEqual({ $project: { text: 1, _uql_joined_author: 1, score: 1, _id: 0 } });
  });

  /**
   * The distance is added to the document, not projected in place of it: a query that named no columns
   * asked for the whole document plus a distance, and `$project` would have narrowed it to the distance.
   */
  it('should add the distance as a field, leaving a query with no projection unnarrowed', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'similarity' } },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({
      $addFields: { similarity: vectorDistanceExpr('embedding', [1, 2, 3], 'cosine') },
    });
    expect(pipeline.some((stage) => '$project' in stage)).toBe(false);
  });

  /** As on SQL: the distance would overwrite the field of that name in every document it came back in. */
  it('should refuse to project the distance over a field', async () => {
    const { querier } = createRecordingQuerier([]);

    await expect(
      querier.findMany(Article, { $sort: { embedding: { $vector: [1, 2, 3], $project: 'title' } }, $limit: 5 }),
    ).rejects.toThrow("$project 'title' collides with a field of 'Article'");
  });

  it('should add $project with $select and distance projection combined', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $select: { id: true, title: true },
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $addFields: { score: vectorDistanceExpr('embedding', [1, 2, 3], 'cosine') } });
    // Already a real field by then, so the query's own projection just keeps it.
    expect(pipeline).toContainEqual({ $project: { _id: 1, title: 1, score: 1 } });
  });

  it('should add $project for $select without score projection', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $select: { id: true, title: true },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $project: { _id: 1, title: 1 } });
  });

  it('should add $project for a falsy $select without score projection in vector pipeline', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $select: { category: false },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $project: { _id: 1, title: 1, embedding: 1 } });
  });

  /** As on SQL, the distance ranks first wherever it appears: the other keys only break its ties. */
  it('should keep the distance first under the other sort keys', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] }, title: -1 },
      $limit: 10,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({
      $addFields: { _uql_nearest: vectorDistanceExpr('embedding', [1, 2, 3], 'cosine') },
    });
    expect(pipeline).toContainEqual({ $sort: { _uql_nearest: 1, title: -1 } });
    expect(pipeline.at(-1)).toEqual({ $unset: ['_uql_nearest'] });
  });

  /** Atlas can rank only by its index's metric, so a search asking for another is refused, not answered by that one. */
  it('should refuse a $distance the Atlas index does not rank by', async () => {
    const { querier } = createRecordingQuerier([]);

    await expect(
      querier.findMany(RankedByInner, { $sort: { embedding: { $vector: [1, 2, 3], $distance: 'l2' } }, $limit: 10 }),
    ).rejects.toThrow("cannot rank 'RankedByInner.embedding' by 'l2' on MongoDB: its Atlas index ranks by 'inner'");
    await querier.findMany(RankedByInner, {
      $sort: { embedding: { $vector: [1, 2, 3], $distance: 'inner' } },
      $limit: 10,
    });
  });

  /** The Atlas index ranks by its own metric, so the distance projected beside its ranking is by that one. */
  it('should project the distance by the metric the Atlas index ranks by', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(RankedByInner, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'distance' } },
      $limit: 10,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $addFields: { distance: vectorDistanceExpr('embedding', [1, 2, 3], 'inner') } });
  });

  it('should merge $where into $vectorSearch.filter for pre-filtering', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $where: { category: 'science' },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    expect(pipelineOf(aggregate.mock.calls)[0]).toMatchObject({ $vectorSearch: { filter: { category: 'science' } } });
  });

  it('should default $limit to 10 when omitted', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] } },
    });

    expect(pipelineOf(aggregate.mock.calls)[0]).toMatchObject({ $vectorSearch: { limit: 10, numCandidates: 100 } });
  });

  /** `/http` casts client JSON straight to `Query`, so a count Atlas would answer with an error of its own is refused. */
  it('should refuse a candidate count that is no positive integer', async () => {
    const { querier } = createRecordingQuerier([]);

    await expect(
      querier.findMany(Article, { $sort: { embedding: { $vector: [1, 2, 3] } }, $candidates: -5 }),
    ).rejects.toThrow('$candidates must be a positive integer, got -5');
  });
});

describe('MongodbQuerier relation conditions', () => {
  /** `countDocuments` takes a plain filter, so a relation condition has to count through a pipeline. */
  it('should count through an aggregation when the $where constrains a relation', async () => {
    const { querier, aggregate } = createRecordingQuerier([{ [AGGREGATE_VALUE_ALIAS]: 3 }]);
    const countDocuments = vi.spyOn(Collection.prototype, 'countDocuments');

    expect(await querier.count(Post, { $where: { author: { name: 'ada' } } })).toBe(3);
    expect(countDocuments).not.toHaveBeenCalled();
    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline[0]).toHaveProperty('$lookup');
    expect(pipeline.at(-1)).toEqual({ $count: AGGREGATE_VALUE_ALIAS });
  });

  it('should report zero when the aggregation matches nothing', async () => {
    const { querier } = createRecordingQuerier();

    expect(await querier.count(Post, { $where: { author: { name: 'nobody' } } })).toBe(0);
  });

  /** The cheap shape on Mongo too: a count of one capped match, which stops at the first. */
  it('should check existence with a count capped at one', async () => {
    const { querier, aggregate } = createRecordingQuerier([{ [AGGREGATE_VALUE_ALIAS]: 1 }]);

    expect(await querier.exists(Post, { $where: { authorId: 9 } })).toBe(true);
    expect(pipelineOf(aggregate.mock.calls)).toEqual([
      { $match: { authorId: 9 } },
      { $limit: 1 },
      { $count: AGGREGATE_VALUE_ALIAS },
    ]);
  });

  /** No matching row means the capped count comes back empty, which is a false rather than a throw. */
  it('should report false when the capped count matches nothing', async () => {
    const { querier } = createRecordingQuerier();

    expect(await querier.exists(Post, { $where: { authorId: 9 } })).toBe(false);
  });

  /** A `$distinct` read counts past the stages that collapse it, which only the read pipeline builds. */
  it('should count a $distinct read past the stages that collapse it', async () => {
    const { querier, aggregate, toArray } = createRecordingQuerier();
    toArray.mockResolvedValueOnce([{ name: 'a' }]).mockResolvedValueOnce([{ [AGGREGATE_VALUE_ALIAS]: 2 }]);
    const countDocuments = vi.spyOn(Collection.prototype, 'countDocuments');

    const [, total] = await querier.findManyAndCount(Item, { $select: { name: true }, $distinct: true });

    expect(countDocuments).not.toHaveBeenCalled();
    const pipeline = pipelineOf(aggregate.mock.calls, 1);
    expect(pipeline.at(-1)).toEqual({ $count: AGGREGATE_VALUE_ALIAS });
    expect(pipeline.some((stage) => stage['$group'])).toBe(true);
    expect(total).toBe(2);
  });

  /** An `updateMany` filter cannot host a `$lookup`, so the ids are resolved first. */
  it('should resolve ids before updating when the $where constrains a relation', async () => {
    const { querier } = createRecordingQuerier([{ _id: 1 }, { _id: 2 }]);
    const updateMany = vi.spyOn(Collection.prototype, 'updateMany').mockResolvedValue(updateResult(2));

    expect(await querier.updateMany(Post, { $where: { author: { name: 'ada' } } }, { authorId: 9 })).toBe(2);
    expect(updateMany.mock.calls[0][0]).toEqual({ _id: { $in: [1, 2] } });
  });

  it('should open no transaction of its own for an update that reads its ids first', async () => {
    const { querier } = createRecordingQuerier([{ _id: 1 }, { _id: 2 }]);
    const start = vi.spyOn(ClientSession.prototype, 'startTransaction');
    vi.spyOn(Collection.prototype, 'updateMany').mockResolvedValue(updateResult(2));

    await querier.updateMany(Post, { $where: { author: { name: 'ada' } } }, { authorId: 9 });
    expect(start).not.toHaveBeenCalled();
  });
});

describe('MongodbQuerier soft delete', () => {
  /**
   * Reads filter on the mapped column, so the stamp has to write that same one - stamping the property
   * key reported a successful delete and left the document visible forever.
   */
  it('should stamp the mapped soft-delete column', async () => {
    const { querier } = createRecordingQuerier([{ _id: 7 }]);
    const updateMany = vi.spyOn(Collection.prototype, 'updateMany').mockResolvedValue(updateResult(1));

    await querier.deleteOneById(SoftDoc, 7);

    expect(updateMany.mock.calls[0][1]).toEqual({ $set: { deleted_at: expect.any(Date) } });
  });
});

describe('MongodbQuerier findManyStream', () => {
  it('should yield nothing, and open no cursor, for a page of no rows', async () => {
    const { querier, find } = createRecordingQuerier([{ _id: 1 }]);
    const rows: unknown[] = [];
    for await (const row of querier.findManyStream(Item, { $limit: 0 })) {
      rows.push(row);
    }
    expect(rows).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  /** A stream runs the pipeline `findMany` does, so it loads what `findMany` loads. */
  it('should stream the relations a query populates through the pipeline', async () => {
    const { querier, aggregate, find } = createRecordingQuerier([
      { _id: 1, _uql_joined_author: { _id: 2, name: 'ada' } },
    ]);
    const rows: unknown[] = [];
    for await (const row of querier.findManyStream(Post, { $populate: { author: true } })) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1, author: { id: 2, name: 'ada' } }]);
    expect(find).not.toHaveBeenCalled();
    expect(pipelineOf(aggregate.mock.calls)).toContainEqual({
      $lookup: { from: 'Author', localField: 'authorId', foreignField: '_id', as: '_uql_joined_author' },
    });
  });

  it('should surface a failure the cursor meets while iterating', async () => {
    const { querier, iterate } = createRecordingQuerier();
    iterate.mockImplementation(async function* () {
      yield* [];
      throw new Error('connection reset');
    });
    const drain = async () => {
      for await (const _ of querier.findManyStream(Item, {}));
    };
    await expect(drain()).rejects.toThrow('connection reset');
  });

  /** An ordering by a relation reads a field only a lookup adds, so the stream orders it in the pipeline. */
  it('should order a stream by a relation through the pipeline', async () => {
    const { querier, aggregate, find } = createRecordingQuerier();
    for await (const _ of querier.findManyStream(Post, { $sort: { author: { name: 1 } } })) {
    }

    expect(find).not.toHaveBeenCalled();
    expect(pipelineOf(aggregate.mock.calls)).toContainEqual({ $sort: { '_uql_joined_author.name': 1 } });
  });
});

/** What a driver reports for an `updateMany` that matched `matchedCount` documents. */
function updateResult(matchedCount: number) {
  return { acknowledged: true, matchedCount, modifiedCount: matchedCount, upsertedCount: 0, upsertedId: null };
}
