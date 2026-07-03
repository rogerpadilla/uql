import { type Mock, vi } from 'vitest';
import type { Querier } from '../type/index.js';

export type MockedQuerier = {
  [K in keyof Querier]: Mock;
};

/**
 * Bare mocked {@link Querier} for transport-layer specs: CRUD methods plus the
 * transaction lifecycle. `rollbackTransaction` resolves so error paths can await it.
 */
export function createMockQuerier(): MockedQuerier {
  return {
    findOne: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    saveOne: vi.fn(),
    saveMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as MockedQuerier;
}
