import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../test/index.js';
import type { Query, QuerySearch, Type } from '../type/index.js';
import { AbstractQuerier } from './abstractQuerier.js';

/**
 * Mock implementation to test the dual-API (entity-as-argument vs entity-as-field)
 */
class MockQuerier extends AbstractQuerier {
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

  override internalInsertMany(): any {
    return Promise.resolve([]);
  }

  override internalUpdateMany(): any {
    return Promise.resolve(0);
  }

  override upsertOne(): any {
    return Promise.resolve({ firstId: null, changes: 0 });
  }

  override upsertMany(): any {
    return Promise.resolve({ changes: 0 });
  }

  protected override internalDeleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: any): Promise<number> {
    this.deleteManyMock(entity, q, opts);
    return Promise.resolve(0);
  }

  protected override internalAggregate(): any {
    return Promise.resolve([]);
  }

  override async beginTransaction() {}
  override commitTransaction(): any {}
  override rollbackTransaction(): any {}
  protected override internalRelease(): any {}
  hasOpenTransaction = false;
}

describe('Dual API Pattern: $entity field support', () => {
  let querier: MockQuerier;

  beforeEach(() => {
    querier = new MockQuerier();
  });

  describe('findOne', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      await querier.findOne(User, { $where: { id: 1 } });

      expect(querier.findManyMock).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          $where: { id: 1 },
          $limit: 1,
        }),
      );
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.findOne({ $entity: User, $where: { id: 1 } });

      expect(querier.findManyMock).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          $where: { id: 1 },
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
      await querier.findManyAndCount(User, { $where: { companyId: 1 } });

      expect(querier.findManyMock).toHaveBeenCalledWith(User, { $where: { companyId: 1 } });
      expect(querier.countMock).toHaveBeenCalledWith(User, { $where: { companyId: 1 } });
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.findManyAndCount({ $entity: User, $where: { companyId: 1 } });

      expect(querier.findManyMock).toHaveBeenCalledWith(User, { $where: { companyId: 1 } });
      expect(querier.countMock).toHaveBeenCalledWith(User, { $where: { companyId: 1 } });
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
      await querier.deleteMany(User, { $where: { id: 1 } });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(User, { $where: { id: 1 } }, undefined);
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      await querier.deleteMany({ $entity: User, $where: { id: 1 } });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(User, { $where: { id: 1 } }, undefined);
    });

    it('should pass options correctly with entity-as-argument pattern', async () => {
      await querier.deleteMany(User, { $where: { id: 1 } }, { softDelete: true });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(User, { $where: { id: 1 } }, { softDelete: true });
    });

    it('should pass options correctly with entity-as-field pattern', async () => {
      await querier.deleteMany({ $entity: User, $where: { id: 1 } }, { softDelete: true });

      expect(querier.deleteManyMock).toHaveBeenCalledWith(User, { $where: { id: 1 } }, { softDelete: true });
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

  describe('lifecycle hook emission', () => {
    let emitHookSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      emitHookSpy = vi.spyOn(querier as any, 'emitHook').mockResolvedValue(undefined);
    });

    it('should emit afterLoad for findMany', async () => {
      await querier.findMany(User, { $where: { id: 1 } });

      expect(emitHookSpy).toHaveBeenCalledWith(User, 'afterLoad', []);
    });

    it('should emit afterLoad for findManyAndCount', async () => {
      await querier.findManyAndCount(User, { $where: { id: 1 } });

      expect(emitHookSpy).toHaveBeenCalledWith(User, 'afterLoad', []);
    });

    it('should emit beforeInsert and afterInsert for insertMany', async () => {
      const payload = [{ name: 'test' }] as User[];
      await querier.insertMany(User, payload);

      expect(emitHookSpy).toHaveBeenCalledWith(User, 'beforeInsert', payload);
      expect(emitHookSpy).toHaveBeenCalledWith(User, 'afterInsert', payload);
    });

    it('should emit beforeUpdate and afterUpdate for updateMany', async () => {
      await querier.updateMany(User, { $where: { id: 1 } }, { name: 'updated' });

      expect(emitHookSpy).toHaveBeenCalledWith(User, 'beforeUpdate', [{ name: 'updated' }]);
      expect(emitHookSpy).toHaveBeenCalledWith(User, 'afterUpdate', [{ name: 'updated' }]);
    });

    it('should emit beforeDelete and afterDelete for deleteMany', async () => {
      await querier.deleteMany(User, { $where: { id: 1 } });

      expect(emitHookSpy).toHaveBeenCalledWith(User, 'beforeDelete', []);
      expect(emitHookSpy).toHaveBeenCalledWith(User, 'afterDelete', []);
    });
  });

  describe('findManyStream', () => {
    it('should work with entity-as-argument (classic pattern)', async () => {
      const collected: User[] = [];
      for await (const row of querier.findManyStream(User, { $where: { companyId: 1 } })) {
        collected.push(row);
      }

      expect(querier.findManyStreamMock).toHaveBeenCalledWith(User, { $where: { companyId: 1 } });
      expect(collected).toEqual([]);
    });

    it('should work with entity-as-field ($entity pattern)', async () => {
      const collected: User[] = [];
      for await (const row of querier.findManyStream({ $entity: User, $where: { companyId: 1 } })) {
        collected.push(row);
      }

      expect(querier.findManyStreamMock).toHaveBeenCalledWith(User, { $where: { companyId: 1 } });
      expect(collected).toEqual([]);
    });

    it('should not emit lifecycle hooks', async () => {
      const emitHookSpy = vi.spyOn(querier as any, 'emitHook');

      for await (const _ of querier.findManyStream(User, { $where: { id: 1 } })) {
        // consume
      }

      expect(emitHookSpy).not.toHaveBeenCalled();
    });

    it('should yield rows in order', async () => {
      const rows = [
        { id: 1, name: 'Alice', companyId: 1 } as User,
        { id: 2, name: 'Bob', companyId: 1 } as User,
        { id: 3, name: 'Charlie', companyId: 1 } as User,
      ];

      // Override the mock to yield actual data
      vi.spyOn(querier as any, 'internalFindManyStream').mockReturnValue(
        (async function* () {
          yield* rows;
        })(),
      );

      const collected: User[] = [];
      for await (const row of querier.findManyStream(User, { $where: { companyId: 1 } })) {
        collected.push(row);
      }

      expect(collected).toEqual(rows);
      expect(collected).toHaveLength(3);
    });
  });
});
