import { expect, test } from 'vitest';
import { AbstractQuerier } from '../abstractQuerier.js';
import { Serialized } from './serialized.js';

class MockQuerier extends AbstractQuerier {
  activeCount = 0;
  maxConcurrency = 0;
  executionOrder: number[] = [];

  @Serialized()
  async slowMethod(id: number, delay: number) {
    this.activeCount++;
    this.maxConcurrency = Math.max(this.maxConcurrency, this.activeCount);
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.executionOrder.push(id);
    this.activeCount--;
    return id;
  }

  // Abstract methods required by AbstractQuerier
  findMany(): any {}
  count(): any {}
  insertMany(): any {}
  updateMany(): any {}
  upsertOne(): any {}
  deleteMany(): any {}
  beginTransaction(): any {}
  commitTransaction(): any {}
  rollbackTransaction(): any {}
  protected internalRelease(): any {}
  hasOpenTransaction = false;
}

test('Serialized decorator executes tasks sequentially', async () => {
  const querier = new MockQuerier();
  // Fire 3 "parallel" calls
  const results = await Promise.all([querier.slowMethod(1, 100), querier.slowMethod(2, 50), querier.slowMethod(3, 10)]);
  // Even though 3 finished faster, it should be last because it was queued last
  expect(results).toEqual([1, 2, 3]);
  expect(querier.executionOrder).toEqual([1, 2, 3]);
  // CRITICAL: Max concurrency must be 1
  expect(querier.maxConcurrency).toBe(1);
});

test('Serialized decorator advances queue even on failure', async () => {
  class FailingQuerier extends MockQuerier {
    @Serialized()
    async failingMethod() {
      throw new Error('boom');
    }
  }

  const querier = new FailingQuerier();
  const promise1 = querier.failingMethod();
  const promise2 = querier.slowMethod(2, 10);
  await expect(promise1).rejects.toThrow('boom');
  const result2 = await promise2;
  expect(result2).toBe(2);
  expect(querier.executionOrder).toEqual([2]);
});

test('Demonstrate deadlock when a @Serialized method calls another @Serialized method', async () => {
  class DeadlockQuerier extends MockQuerier {
    @Serialized()
    async outer() {
      return this.inner();
    }

    @Serialized()
    async inner() {
      return 'done';
    }
  }

  const querier = new DeadlockQuerier();

  // We expect this to deadlock/timeout because 'outer' holds the queue and waits for 'inner',
  // but 'inner' is waiting for the queue to be free.
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DEADLOCK')), 500));

  await expect(Promise.race([querier.outer(), timeoutPromise])).rejects.toThrow('DEADLOCK');
});

test('Proper solution: @Serialized method calls a non-decorated internal method', async () => {
  class SafeQuerier extends MockQuerier {
    @Serialized()
    async publicMethod() {
      return this.internalMethod();
    }

    async internalMethod() {
      return 'safe';
    }
  }

  const querier = new SafeQuerier();
  await expect(querier.publicMethod()).resolves.toBe('safe');
});
