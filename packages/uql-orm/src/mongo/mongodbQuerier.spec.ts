import { describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, Index, ManyToOne } from '../entity/index.js';
import { Item, User } from '../test/entityMock.js';
import { COUNT_AGG_ALIAS } from '../util/index.js';
import { MongoDialect } from './mongoDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';

// --- Test entity ---
@Entity({ name: 'Article' })
@Index(['embedding'], { type: 'vectorSearch', name: 'embedding_vs' })
class Article {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ type: String }) category?: string;
  @Field({ type: 'vector' }) embedding?: number[];
}

@Entity({ name: 'Author' })
class Author {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

@Entity({ name: 'Post' })
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Author }) authorId?: number;
  @ManyToOne({ entity: () => Author }) author?: Author;
  @Field({ references: () => Author }) reviewerId?: number;
  @ManyToOne({ entity: () => Author }) reviewer?: Author;
}

/** Soft-deletable through a renamed column. */
@Entity({ name: 'SoftDoc' })
class SoftDoc {
  @Id({ type: Number }) id?: number;
  @Field({ type: Date, name: 'deleted_at', softDelete: true }) deletedAt?: Date;
}

/** An entity that is both vector-searchable and has a relation, for the combined case. */
@Entity({ name: 'Chunk' })
@Index(['embedding'], { type: 'vectorSearch', name: 'chunk_vs' })
class Chunk {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) text?: string;
  @Field({ references: () => Author }) authorId?: number;
  @ManyToOne({ entity: () => Author }) author?: Author;
  @Field({ type: 'vector' }) embedding?: number[];
}

function createMockedQuerier(aggregateResults: unknown[] = []) {
  const toArray = vi.fn().mockResolvedValue(aggregateResults);
  const aggregate = vi.fn().mockReturnValue({ toArray });
  // Every cursor method chains, so one self-returning stub stands in for the whole builder.
  const cursor: Record<string, unknown> = { toArray };
  for (const method of ['filter', 'project', 'sort', 'skip', 'limit', 'map']) {
    cursor[method] = () => cursor;
  }
  const find = vi.fn().mockReturnValue(cursor);

  const dialect = new MongoDialect();
  const querier = new MongodbQuerier(dialect, {} as any);

  vi.spyOn(querier, 'collection').mockReturnValue({ aggregate, find } as any);

  return { querier, aggregate, find };
}

/**
 * Which of the two read paths a query takes: the cheap plain `find` cursor, or the aggregation
 * pipeline for the clauses a cursor cannot express. `$distinct` was missing from that list and got
 * dropped silently for want of this test. Both directions are pinned - the fast path staying fast
 * matters as much as an unexpressible clause reaching the pipeline.
 */
describe('MongodbQuerier read routing', () => {
  it('serves a plain query from the find cursor', async () => {
    const { querier, aggregate, find } = createMockedQuerier();
    await querier.findMany(Item, { $select: { name: true }, $where: { name: 'x' }, $limit: 2 });
    expect(find).toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('sends a clause the cursor cannot express to the pipeline', async () => {
    const { querier, aggregate, find } = createMockedQuerier();
    await querier.findMany(Item, { $select: { name: true }, $distinct: true });
    expect(aggregate).toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});

describe('MongodbQuerier vector search', () => {
  it('should route vector sort through $vectorSearch pipeline', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    expect(aggregate).toHaveBeenCalled();
    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0]).toHaveProperty('$vectorSearch');
    expect(pipeline[0].$vectorSearch.index).toBe('embedding_vs');
    expect(pipeline[0].$vectorSearch.queryVector).toEqual([1, 2, 3]);
    expect(pipeline[0].$vectorSearch.limit).toBe(10);
    expect(pipeline[0].$vectorSearch.numCandidates).toBe(100);
  });

  it('loads relations under a vector sort, capturing the score before the lookups', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Chunk, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $populate: { author: true },
      $limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0]).toHaveProperty('$vectorSearch');
    // `$addFields` rather than `$project`: projecting here would drop the join key and the joined doc
    expect(pipeline[1]).toEqual({ $addFields: { score: { $meta: 'vectorSearchScore' } } });
    expect(pipeline[2]).toEqual({
      $lookup: { from: 'Author', localField: 'authorId', foreignField: '_id', as: 'author' },
    });
    expect(pipeline[3]).toEqual({ $unwind: { path: '$author', preserveNullAndEmptyArrays: true } });
    expect(pipeline.some((s: Record<string, unknown>) => '$project' in s)).toBe(false);
  });

  it('projects after the lookups when a vector query narrows its columns', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Chunk, {
      $select: { text: true },
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $populate: { author: true },
      $limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const unwindIndex = pipeline.findIndex((s: Record<string, unknown>) => '$unwind' in s);
    const projectIndex = pipeline.findIndex((s: Record<string, unknown>) => '$project' in s);
    expect(projectIndex).toBeGreaterThan(unwindIndex);
    expect(pipeline[projectIndex].$project).toEqual({ text: 1, author: 1, score: 1 });
  });

  /**
   * The score is added to the document, not projected in place of it: a query that named no columns
   * asked for the whole document plus a score, and `$project` would have narrowed it to the score.
   */
  it('adds the score as a field, leaving a query with no projection unnarrowed', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'similarity' } },
      $limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const addFields = pipeline.find((s: Record<string, unknown>) => '$addFields' in s);
    expect(addFields.$addFields.similarity).toEqual({ $meta: 'vectorSearchScore' });
    expect(pipeline.find((s: Record<string, unknown>) => '$project' in s)).toBeUndefined();
  });

  it('should add $project with $select and score projection combined', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $select: { id: true, title: true },
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const addFields = pipeline.find((s: Record<string, unknown>) => '$addFields' in s);
    expect(addFields.$addFields.score).toEqual({ $meta: 'vectorSearchScore' });
    // Already a real field by then, so the query's own projection just keeps it.
    const projectStage = pipeline.find((s: Record<string, unknown>) => '$project' in s);
    expect(projectStage.$project).toEqual({ _id: 1, title: 1, score: 1 });
  });

  it('should add $project for $select without score projection', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $select: { id: true, title: true },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const projectStage = pipeline.find((s: Record<string, unknown>) => '$project' in s);
    expect(projectStage).toBeDefined();
    expect(projectStage.$project).toEqual({ _id: 1, title: 1 });
  });

  it('should add $project for $exclude only without score projection in vector pipeline', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $exclude: { category: true },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const projectStage = pipeline.find((s: Record<string, unknown>) => '$project' in s);
    expect(projectStage).toBeDefined();
    expect(projectStage.$project).toEqual({ _id: 1, title: 1, embedding: 1 });
  });

  it('should add secondary $sort for regular sort fields', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] }, title: -1 },
      $limit: 10,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const sortStage = pipeline.find((s: Record<string, unknown>) => '$sort' in s);
    expect(sortStage).toBeDefined();
    expect(sortStage.$sort).toEqual({ title: -1 });
  });

  it('should merge $where into $vectorSearch.filter for pre-filtering', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $where: { category: 'science' },
      $sort: { embedding: { $vector: [1, 2, 3] } },
      $limit: 10,
    });

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({ category: 'science' });
  });

  it('should default $limit to 10 when omitted', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3] } },
    });

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.limit).toBe(10);
    expect(pipeline[0].$vectorSearch.numCandidates).toBe(100);
  });
});

describe('MongodbQuerier relation conditions', () => {
  /** `countDocuments` takes a plain filter, so a relation condition has to count through a pipeline. */
  it('counts through an aggregation when the $where constrains a relation', async () => {
    const toArray = vi.fn().mockResolvedValue([{ [COUNT_AGG_ALIAS]: 3 }]);
    const aggregate = vi.fn().mockReturnValue({ toArray });
    const countDocuments = vi.fn();
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({ aggregate, countDocuments } as any);

    expect(await querier.count(Post, { $where: { author: { name: 'ada' } } })).toBe(3);
    expect(countDocuments).not.toHaveBeenCalled();
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0]).toHaveProperty('$lookup');
    expect(pipeline.at(-1)).toEqual({ $count: COUNT_AGG_ALIAS });
  });

  it('reports zero when the aggregation matches nothing', async () => {
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as any);

    expect(await querier.count(Post, { $where: { author: { name: 'nobody' } } })).toBe(0);
  });

  /** The cheap shape on Mongo too: one capped `find`, never `countDocuments` or an aggregation. */
  it('checks existence with a capped find rather than a count', async () => {
    const cursor = {
      filter: vi.fn(),
      project: vi.fn(),
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      toArray: vi.fn().mockResolvedValue([{ _id: 1 }]),
    };
    const find = vi.fn().mockReturnValue(cursor);
    const countDocuments = vi.fn();
    const aggregate = vi.fn();
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({ find, countDocuments, aggregate } as any);

    expect(await querier.exists(Post, { $where: { authorId: 9 } })).toBe(true);
    expect(countDocuments).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
    expect(cursor.filter).toHaveBeenCalledWith({ authorId: 9 });
    expect(cursor.project).toHaveBeenCalledWith({ _id: 1 });
    expect(cursor.limit).toHaveBeenCalledWith(1);
    expect(cursor.skip).not.toHaveBeenCalled();
  });

  /** No matching row means the capped find comes back empty, which is a false rather than a throw. */
  it('reports false when the capped find matches nothing', async () => {
    const cursor = {
      filter: vi.fn(),
      project: vi.fn(),
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({ find: vi.fn().mockReturnValue(cursor) } as any);

    expect(await querier.exists(Post, { $where: { authorId: 9 } })).toBe(false);
  });

  /** An `updateMany` filter cannot host a `$lookup`, so the ids are resolved first. */
  it('resolves ids before updating when the $where constrains a relation', async () => {
    const updateMany = vi.fn().mockResolvedValue({ matchedCount: 2 });
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: 1 }, { _id: 2 }]) }),
      updateMany,
    } as any);

    expect(await querier.updateMany(Post, { $where: { author: { name: 'ada' } } }, { authorId: 9 })).toBe(2);
    expect(updateMany.mock.calls[0][0]).toEqual({ _id: { $in: [1, 2] } });
  });
});

describe('MongodbQuerier soft delete', () => {
  /**
   * Reads filter on the mapped column, so the stamp has to write that same one - stamping the property
   * key reported a successful delete and left the document visible forever.
   */
  it('stamps the mapped soft-delete column', async () => {
    const updateMany = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const toArray = vi.fn().mockResolvedValue([{ _id: 7 }]);
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({
      aggregate: vi.fn().mockReturnValue({ toArray }),
      updateMany,
    } as any);

    await querier.deleteOneById(SoftDoc, 7);

    const [, update] = updateMany.mock.calls[0];
    expect(Object.keys(update.$set)).toEqual(['deleted_at']);
  });
});

describe('MongodbQuerier findManyStream', () => {
  it('throws when relations are requested (stream uses find cursor only)', async () => {
    const querier = new MongodbQuerier(new MongoDialect(), {} as any, {});
    await expect(
      (async () => {
        for await (const _ of querier.findManyStream(User, { $populate: { profile: true } })) {
        }
      })(),
    ).rejects.toThrow('findManyStream does not load relations on MongoDB');
  });

  /** The cursor has no `$lookup`, so the ordering would read a field that is not on the document. */
  it('throws when the ordering names a relation', async () => {
    const querier = new MongodbQuerier(new MongoDialect(), {} as any, {});
    await expect(
      (async () => {
        for await (const _ of querier.findManyStream(User, { $sort: { profile: { picture: 1 } } } as never)) {
        }
      })(),
    ).rejects.toThrow('findManyStream does not order by a relation on MongoDB');
  });
});
