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
 * Bare mocked {@link Querier} for transport-layer specs, every method a mock but `transaction`, the real one
 * over these primitives, so "this ran in a transaction" asserts the sequence the ORM performs; its logger is
 * off. `extra` adds what a spec needs on top (`run`, `all`, `dialect`), onto the same object, so
 * `hasOpenTransaction` stays the one the recorders set.
 */
export function createMockQuerier<E extends object = Record<never, never>>(extra?: E): MockedQuerier & E {
  const querier: MockedQuerier & { readonly logger: LoggerWrapper } = {
    hasOpenTransaction: false,
    transaction: AbstractQuerier.prototype.transaction,
    logger: new LoggerWrapper(false),
    findOneById: vi.fn(),
    findOne: vi.fn(),
    findMany: vi.fn(),
    findManyStream: vi.fn(),
    findManyAndCount: vi.fn(),
    findManyPage: vi.fn(),
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
  return Object.assign(querier, extra);
}
