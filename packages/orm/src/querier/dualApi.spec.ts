import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { MeasureUnitCategory, User, VectorItem } from '../test/index.js';
import type {
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryGroupMap,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  Type,
} from '../type/index.js';
import { AbstractQuerier } from './abstractQuerier.js';

/**
 * Mock implementation to test the dual-API (entity-as-argument vs entity-as-field)
 */
class MockQuerier extends AbstractQuerier {
  readonly dialect = new PostgresDialect();
  findManyMock = vi.fn().mockResolvedValue([]);
  countMock = vi.fn().mockResolvedValue(0);
  deleteManyMock = vi.fn().mockResolvedValue(0);

  findManyStreamMock = vi.fn();

  protected override internalFindMany<E>(entity: Type<E>, q: Query<E>): Promise<E[]> {
    this.findManyMock(entity, q);
    return Promise.resolve([]);
  }

  protected override internalFindManyStream<E>(entity: Type<E>, q: Query<E>): AsyncIterable<E> {
    this.findManyStreamMock(entity, q);
    // Return an empty async iterable
    return { async *[Symbol.asyncIterator]() {} };
  }

  protected override internalCount<E>(entity: Type<E>, q: QuerySearch<E>): Promise<number> {
    this.countMock(entity, q);
    return Promise.resolve(0);
  }

  override async internalInsertMany(): Promise<void> {}

  override async internalUpdateMany(): Promise<number> {
    return 0;
  }

  protected override async internalUpsertOne(): Promise<QueryUpdateResult> {
    return { changes: 0 };
  }

  protected override async internalUpsertMany(): Promise<QueryUpdateResult> {
    return { changes: 0 };
  }

  protected override internalDeleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number> {
    this.deleteManyMock(entity, q, opts);
    return Promise.resolve(0);
  }

  protected override async internalAggregate<E extends object, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    _entity: Type<E>,
    _q: QueryAggregate<E, G, A>,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return [];
  }

  override estimatedCount(): Promise<number> {
    return Promise.resolve(0);
  }

  override async beginTransaction() {}
  override async commitTransaction() {}
  override async rollbackTransaction() {}
  protected override async internalRelease() {}
  hasOpenTransaction = false;
}

describe('Dual API Pattern: $entity field support', () => {
  let querier: MockQuerier;

  beforeEach(() => {
    querier = new MockQuerier();
  });

  describe('findOneById', () => {
    it('should do not mutate the query when reading with a vector sort', async () => {
      const query = {
        $where: { name: 'north' },
        $sort: { vec: { $vector: [1, 2, 3], $project: 'distance' } },
      } as const;

      const result = await querier.findOneById(VectorItem, 1, query);

      expectTypeOf(result).toEqualTypeOf<VectorItem | undefined>();
      expect(query).toEqual({
        $where: { name: 'north' },
        $sort: { vec: { $vector: [1, 2, 3], $project: 'distance' } },
      });
    });
  });

  describe('findOne', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      await querier.findOne(User, { $where: { id: '1' } });

      expect(querier.findManyMock).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          $where: { id: '1' },
          $limit: 1,
        }),
      );
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.findOne({ $entity: User, $where: { id: '1' } });

      expect(querier.findManyMock).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          $where: { id: '1' },
          $limit: 1,
        }),
      );
    });

    it('should throw error when $entity is missing in query-object syntax', async () => {
      // @ts-expect-error - Testing runtime behavior
      await expect(querier.findOne({ $where: { id: 1 } })).rejects.toThrow(
        '$entity is required when using query-object syntax',
      );
    });
  });

  describe('findMany', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      await querier.findMany(User, { $where: { name: { $startsWith: 'John' } }, $limit: 10 });

      expect(querier.findManyMock).toHaveBeenCalledWith(User, {
        $where: { name: { $startsWith: 'John' } },
        $limit: 10,
      });
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.findMany({ $entity: User, $where: { name: { $startsWith: 'John' } }, $limit: 10 });

      expect(querier.findManyMock).toHaveBeenCalledWith(User, {
        $where: { name: { $startsWith: 'John' } },
        $limit: 10,
      });
    });

    it('should not include $entity in the query object passed to internalFindMany', async () => {
      await querier.findMany({ $entity: User, $select: { id: true, name: true }, $limit: 5 });

      const [, passedQuery] = querier.findManyMock.mock.calls[0];
      expect(passedQuery).not.toHaveProperty('$entity');
      expect(passedQuery).toEqual({ $select: { id: true, name: true }, $limit: 5 });
    });
  });

  describe('findManyAndCount', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      await querier.findManyAndCount(User, { $where: { companyId: '1' } });

      expect(querier.findManyMock).toHaveBeenCalledWith(User, { $where: { companyId: '1' } });
      expect(querier.countMock).toHaveBeenCalledWith(User, { $where: { companyId: '1' } });
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.findManyAndCount({ $entity: User, $where: { companyId: '1' } });

      expect(querier.findManyMock).toHaveBeenCalledWith(User, { $where: { companyId: '1' } });
      expect(querier.countMock).toHaveBeenCalledWith(User, { $where: { companyId: '1' } });
    });
  });

  describe('count', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      await querier.count(User, { $where: { name: 'test' } });

      expect(querier.countMock).toHaveBeenCalledWith(User, { $where: { name: 'test' } });
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.count({ $entity: User, $where: { name: 'test' } });

      expect(querier.countMock).toHaveBeenCalledWith(User, { $where: { name: 'test' } });
    });
  });

  describe('deleteMany', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      await querier.deleteMany(MeasureUnitCategory, { $where: { id: '1' } });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(MeasureUnitCategory, { $where: { id: '1' } }, undefined);
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.deleteMany({ $entity: MeasureUnitCategory, $where: { id: '1' } });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(MeasureUnitCategory, { $where: { id: '1' } }, undefined);
    });

    it('should pass options correctly with entity-as-argument pattern', async () => {
      await querier.deleteMany(MeasureUnitCategory, { $where: { id: '1' } }, { hardDelete: true });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(
        MeasureUnitCategory,
        { $where: { id: '1' } },
        { hardDelete: true },
      );
    });

    it('should pass options correctly with entity-as-field pattern', async () => {
      await querier.deleteMany({ $entity: MeasureUnitCategory, $where: { id: '1' } }, { hardDelete: true });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(
        MeasureUnitCategory,
        { $where: { id: '1' } },
        { hardDelete: true },
      );
    });
  });

  describe('RPC-style use case', () => {
    it('should allow serializing and deserializing the query', async () => {
      // Simulate receiving a query object from an RPC/REST endpoint
      const serializedQuery = JSON.stringify({
        $where: { name: { $startsWith: 'John' } },
        $limit: 10,
      });

      // Parse and add entity reference (entity can't be JSON-serialized)
      const query = { ...JSON.parse(serializedQuery), $entity: User };

      await querier.findMany(query);

      expect(querier.findManyMock).toHaveBeenCalledWith(User, {
        $where: { name: { $startsWith: 'John' } },
        $limit: 10,
      });
    });
  });

  describe('findManyStream', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      const collected: User[] = [];
      for await (const row of querier.findManyStream(User, { $where: { companyId: '1' } })) {
        collected.push(row);
      }

      expect(querier.findManyStreamMock).toHaveBeenCalledWith(User, { $where: { companyId: '1' } });
      expect(collected).toEqual([]);
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      const collected: User[] = [];
      for await (const row of querier.findManyStream({ $entity: User, $where: { companyId: '1' } })) {
        collected.push(row);
      }

      expect(querier.findManyStreamMock).toHaveBeenCalledWith(User, { $where: { companyId: '1' } });
      expect(collected).toEqual([]);
    });

    it('should yield rows in order', async () => {
      const rows = [
        { id: '1', name: 'Alice', companyId: '1' },
        { id: '2', name: 'Bob', companyId: '1' },
        { id: '3', name: 'Charlie', companyId: '1' },
      ] satisfies User[];

      // Override the mock to yield actual data
      vi.spyOn(querier, 'internalFindManyStream').mockReturnValue(
        (async function* () {
          yield* rows;
        })(),
      );

      const collected: User[] = [];
      for await (const row of querier.findManyStream(User, { $where: { companyId: '1' } })) {
        collected.push(row);
      }

      expect(collected).toEqual(rows);
      expect(collected).toHaveLength(3);
    });
  });

  describe('restore', () => {
    it('should restore by setting the soft-delete field to null, with its filter off', async () => {
      const updateSpy = vi.spyOn(querier, 'updateMany').mockResolvedValue(1);
      await querier.restoreMany(MeasureUnitCategory, { $where: { id: '1' } });
      expect(updateSpy).toHaveBeenCalledWith(
        MeasureUnitCategory,
        expect.objectContaining({ $where: expect.objectContaining({ id: '1', deletedAt: { $ne: null } }) }),
        { deletedAt: null },
        { filters: { softDelete: false } },
      );
    });

    it('should restore one row through restoreMany', async () => {
      const updateSpy = vi.spyOn(querier, 'updateMany').mockResolvedValue(1);
      await querier.restoreOneById(MeasureUnitCategory, '7');
      expect(updateSpy).toHaveBeenCalledWith(
        MeasureUnitCategory,
        expect.objectContaining({ $where: expect.objectContaining({ id: '7', deletedAt: { $ne: null } }) }),
        { deletedAt: null },
        { filters: { softDelete: false } },
      );
    });

    it('should refuse to restore an entity with no soft-delete field', async () => {
      await expect(querier.restoreMany(User, { $where: { id: '1' } })).rejects.toThrow(
        "'User' has not enabled 'softDelete'",
      );
    });
  });
});
