import { describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, Index, ManyToOne } from '../entity/index.js';
import { User } from '../test/entityMock.js';
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

  const dialect = new MongoDialect();
  const querier = new MongodbQuerier(dialect, {} as any);

  vi.spyOn(querier, 'collection').mockReturnValue({ aggregate } as any);

  return { querier, aggregate };
}

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

  it('should add $project stage with $meta for score projection', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'similarity' } },
      $limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline.length).toBeGreaterThanOrEqual(2);
    const projectStage = pipeline.find((s: Record<string, unknown>) => '$project' in s);
    expect(projectStage).toBeDefined();
    expect(projectStage.$project.similarity).toEqual({ $meta: 'vectorSearchScore' });
  });

  it('should add $project with $select and score projection combined', async () => {
    const { querier, aggregate } = createMockedQuerier([]);

    await querier.findMany(Article, {
      $select: { id: true, title: true },
      $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } },
      $limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0];
    const projectStage = pipeline.find((s: Record<string, unknown>) => '$project' in s);
    expect(projectStage).toBeDefined();
    expect(projectStage.$project.score).toEqual({ $meta: 'vectorSearchScore' });
    expect(projectStage.$project._id).toBe(1);
    expect(projectStage.$project.title).toBe(1);
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
    const toArray = vi.fn().mockResolvedValue([{ n: 3 }]);
    const aggregate = vi.fn().mockReturnValue({ toArray });
    const countDocuments = vi.fn();
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({ aggregate, countDocuments } as any);

    expect(await querier.count(Post, { $where: { author: { name: 'ada' } } })).toBe(3);
    expect(countDocuments).not.toHaveBeenCalled();
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0]).toHaveProperty('$lookup');
    expect(pipeline.at(-1)).toEqual({ $count: 'n' });
  });

  it('reports zero when the aggregation matches nothing', async () => {
    const querier = new MongodbQuerier(new MongoDialect(), {} as any);
    vi.spyOn(querier, 'collection').mockReturnValue({
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as any);

    expect(await querier.count(Post, { $where: { author: { name: 'nobody' } } })).toBe(0);
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
    await expect(
      (async () => {
        for await (const _ of querier.findManyStream(User, { $populate: { profile: true } })) {
        }
      })(),
    ).rejects.toThrow('findManyStream does not load relations on MongoDB');
  });
});
