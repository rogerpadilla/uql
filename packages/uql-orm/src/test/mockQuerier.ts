import { type Mock, vi } from 'vitest';
import { AbstractQuerier } from '../querier/abstractQuerier.js';
import type { Querier } from '../type/index.js';

/** Methods become mocks; plain state (`hasOpenTransaction`) keeps its own type so this is a `Querier`. */
export type MockedQuerier = {
  [K in keyof Querier]: Querier[K] extends (...args: never[]) => unknown ? Mock : Querier[K];
};

/**
 * Bare mocked {@link Querier} for transport-layer specs: CRUD methods plus the
 * transaction lifecycle. `rollbackTransaction` resolves so error paths can await it.
 *
 * `transaction` is the real implementation driven by these mocked primitives, and
 * `hasOpenTransaction` tracks them, so a spec asserting "this ran in a transaction" is asserting
 * against the sequence the ORM actually performs rather than a stand-in for it.
 *
 * `extra` adds whatever a spec needs on top (`run`, `all`, `dialect` for the SQL paths).
 */
export function createMockQuerier<E extends object = Record<never, never>>(extra?: E): MockedQuerier & E {
  const querier = {
    hasOpenTransaction: false,
    transaction: AbstractQuerier.prototype.transaction,
    findOne: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    saveOne: vi.fn(),
    saveMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    beginTransaction: vi.fn().mockImplementation(async () => {
      querier.hasOpenTransaction = true;
    }),
    commitTransaction: vi.fn().mockImplementation(async () => {
      querier.hasOpenTransaction = false;
    }),
    rollbackTransaction: vi.fn().mockImplementation(async () => {
      querier.hasOpenTransaction = false;
    }),
    release: vi.fn().mockResolvedValue(undefined),
  };
  // Assigned onto the same object the recorders above close over, so `hasOpenTransaction` stays shared:
  // spreading into a copy would leave the copy's flag stuck at `false`.
  return Object.assign(querier, extra) as unknown as MockedQuerier & E;
}
