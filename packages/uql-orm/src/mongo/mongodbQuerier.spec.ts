import { describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, Index, ManyToOne } from '../entity/index.js';
import { User } from '../test/entityMock.js';
import { MongoDialect } from './mongoDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';

// --- Test entity ---
@Entity({ name: 'Article' })
@Index(['embedding'], { type: 'vectorSearch', name: 'embedding_vs' })
class Article {
  @Id() id?: number;
  @Field() title?: string;
  @Field() category?: string;
  @Field({ type: 'vector' }) embedding?: number[];
}

@Entity({ name: 'Author' })
class Author {
  @Id() id?: number;
  @Field() name?: string;
}

@Entity({ name: 'Post' })
class Post {
  @Id() id?: number;
  @Field({ references: () => Author }) authorId?: number;
  @ManyToOne({ entity: () => Author }) author?: Author;
  @Field({ references: () => Author }) reviewerId?: number;
  @ManyToOne({ entity: () => Author }) reviewer?: Author;
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
    expect(projectStage.$project.id).toBe(1);
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
    expect(projectStage.$project).toEqual({ id: 1, title: 1 });
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
    expect(projectStage.$project).toEqual({ id: 1, title: 1, embedding: 1 });
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
