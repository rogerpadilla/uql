import { AbstractCursor, Collection, type Document, MongoClient } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGGREGATE_VALUE_ALIAS } from '../dialect/aliases.js';
import { Entity, Field, Id, Index, ManyToOne } from '../entity/index.js';
import { assertDefined, Item } from '../test/index.js';
import { MongoDialect } from './mongoDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';

@Entity({ name: 'Article' })
@Index((article) => [article.embedding], { type: 'vectorSearch', name: 'embedding_vs' })
class Article {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) category?: string | null;
  @Field({ type: 'vector' }) embedding?: number[] | null;
}

@Entity({ name: 'Author' })
class Author {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
}

@Entity({ name: 'Post' })
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Author }) authorId?: number | null;
  @ManyToOne({ entity: () => Author, references: (post) => post.authorId }) author?: Author;
  @Field({ references: () => Author }) reviewerId?: number | null;
  @ManyToOne({ entity: () => Author, references: (post) => post.reviewerId }) reviewer?: Author;
}

/** Soft-deletable through a renamed column. */
@Entity({ name: 'SoftDoc' })
class SoftDoc {
  @Id({ type: Number }) id?: number;
  @Field({ type: Date, name: 'deleted_at', softDelete: true }) deletedAt?: Date | null;
}

/** An entity that is both vector-searchable and has a relation, for the combined case. */
@Entity({ name: 'Chunk' })
@Index((chunk) => [chunk.embedding], { type: 'vectorSearch', name: 'chunk_vs' })
class Chunk {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) text?: string | null;
  @Field({ references: () => Author }) authorId?: number | null;
  @ManyToOne({ entity: () => Author, references: (chunk) => chunk.authorId }) author?: Author;
  @Field({ type: 'vector' }) embedding?: number[] | null;
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

  it('should load relations under a vector sort, capturing the score before the lookups', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Chunk, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $populate: { author: true },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline[0]).toHaveProperty('$vectorSearch');
    // `$addFields` rather than `$project`: projecting here would drop the join key and the joined doc
    expect(pipeline[1]).toEqual({ $addFields: { score: { $meta: 'vectorSearchScore' } } });
    expect(pipeline[2]).toEqual({
      $lookup: { from: 'Author', localField: 'authorId', foreignField: '_id', as: 'author' },
    });
    expect(pipeline[3]).toEqual({ $unwind: { path: '$author', preserveNullAndEmptyArrays: true } });
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
    expect(pipeline[projectIndex]).toEqual({ $project: { text: 1, author: 1, score: 1 } });
  });

  /**
   * The score is added to the document, not projected in place of it: a query that named no columns
   * asked for the whole document plus a score, and `$project` would have narrowed it to the score.
   */
  it('should add the score as a field, leaving a query with no projection unnarrowed', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'similarity' } },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $addFields: { similarity: { $meta: 'vectorSearchScore' } } });
    expect(pipeline.some((stage) => '$project' in stage)).toBe(false);
  });

  it('should add $project with $select and score projection combined', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $select: { id: true, title: true },
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $limit: 5,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $addFields: { score: { $meta: 'vectorSearchScore' } } });
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

  it('should add $project for $exclude only without score projection in vector pipeline', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $exclude: { category: true },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $project: { _id: 1, title: 1, embedding: 1 } });
  });

  it('should add secondary $sort for regular sort fields', async () => {
    const { querier, aggregate } = createRecordingQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] }, title: -1 },
      $limit: 10,
    });

    const pipeline = pipelineOf(aggregate.mock.calls);
    expect(pipeline).toContainEqual({ $sort: { title: -1 } });
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
    const { querier, aggregate, find } = createRecordingQuerier([{ _id: 1, author: { _id: 2, name: 'ada' } }]);
    const rows: unknown[] = [];
    for await (const row of querier.findManyStream(Post, { $populate: { author: true } })) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1, author: { id: 2, name: 'ada' } }]);
    expect(find).not.toHaveBeenCalled();
    expect(pipelineOf(aggregate.mock.calls)).toContainEqual({
      $lookup: { from: 'Author', localField: 'authorId', foreignField: '_id', as: 'author' },
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
    expect(pipelineOf(aggregate.mock.calls)).toContainEqual({ $sort: { 'author.name': 1 } });
  });
});

/** What a driver reports for an `updateMany` that matched `matchedCount` documents. */
function updateResult(matchedCount: number) {
  return { acknowledged: true, matchedCount, modifiedCount: matchedCount, upsertedCount: 0, upsertedId: null };
}
