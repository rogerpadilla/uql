import { type Mock, vi } from 'vitest';
import { AbstractQuerier } from '../querier/abstractQuerier.js';
import type { Querier } from '../type/index.js';
import { LoggerWrapper } from '../util/index.js';

/** Methods become mocks, save the real `transaction`; plain state (`hasOpenTransaction`) keeps its own type. */
export type MockedQuerier = {
  -readonly [K in keyof Querier]: K extends 'transaction'
    ? Querier[K]
    : Querier[K] extends (...args: never[]) => unknown
      ? Mock
      : Querier[K];
};

/**
 * Bare mocked {@link Querier} for transport-layer specs: every method a mock, and the transaction
 * lifecycle recorded. `rollbackTransaction` resolves so error paths can await it.
 *
 * `transaction` is the real implementation driven by these mocked primitives, and
 * `hasOpenTransaction` tracks them, so a spec asserting "this ran in a transaction" is asserting
 * against the sequence the ORM actually performs rather than a stand-in for it.
 *
 * `extra` adds whatever a spec needs on top (`run`, `all`, `dialect` for the SQL paths).
 */
export function createMockQuerier<E extends object = Record<never, never>>(extra?: E): MockedQuerier & E {
  const querier: MockedQuerier & { readonly logger: LoggerWrapper } = {
    hasOpenTransaction: false,
    transaction: AbstractQuerier.prototype.transaction,
    // The real `transaction` reports a rollback that fails, so the mock carries a logger for it. `false`
    // means every level is off, which is what a spec that is not asserting on logs wants.
    logger: new LoggerWrapper(false),
    findOneById: vi.fn(),
    findOne: vi.fn(),
    findMany: vi.fn(),
    findManyStream: vi.fn(),
    findManyAndCount: vi.fn(),
    count: vi.fn(),
    exists: vi.fn(),
    estimatedCount: vi.fn(),
    aggregate: vi.fn(),
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    updateOneById: vi.fn(),
    updateMany: vi.fn(),
    upsertOne: vi.fn(),
    upsertMany: vi.fn(),
    saveOne: vi.fn(),
    saveMany: vi.fn(),
    deleteOneById: vi.fn(),
    deleteMany: vi.fn(),
    restoreOneById: vi.fn(),
    restoreMany: vi.fn(),
    beginTransaction: vi.fn(async () => {
      querier.hasOpenTransaction = true;
    }),
    commitTransaction: vi.fn(async () => {
      querier.hasOpenTransaction = false;
    }),
    rollbackTransaction: vi.fn(async () => {
      querier.hasOpenTransaction = false;
    }),
    release: vi.fn(async () => {}),
    [Symbol.asyncDispose]: vi.fn(() => querier.release()),
  };
  // Assigned onto the same object the recorders above close over, so `hasOpenTransaction` stays shared:
  // spreading into a copy would leave the copy's flag stuck at `false`.
  return Object.assign(querier, extra);
}
