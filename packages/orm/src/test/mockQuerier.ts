import { type Mock, type MockInstance, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import type { Querier, SqlStatement } from '../type/index.js';
import { statementOf } from '../util/raw.js';

/** Methods become mocks; plain state (`hasOpenTransaction`) keeps its own type. */
export type MockedQuerier = {
  -readonly [K in keyof Querier]: Querier[K] extends (...args: never[]) => unknown ? Mock : Querier[K];
};

/**
 * Bare mocked {@link Querier} for transport-layer specs, every method a mock. `transaction` and `onCommit` run
 * their callback at once. `extra` adds what a spec needs on top (`run`, `all`, `dialect`).
 */
export function createMockQuerier<E extends object = Record<never, never>>(extra?: E): MockedQuerier & E {
  const querier: MockedQuerier = {
    hasOpenTransaction: false,
    transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
    onCommit: vi.fn(async (callback: () => unknown) => {
      await callback();
    }),
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
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    release: vi.fn(async () => {}),
    [Symbol.asyncDispose]: vi.fn(() => querier.release()),
  };
  return Object.assign(querier, extra);
}

/** The statements a mocked `all` or `run` was sent, as `dialect` renders them: each one's SQL and the values it binds. */
export function sentStatements(
  dialect: AbstractSqlDialect,
  method: MockInstance<(...statement: SqlStatement) => unknown>,
): { sql: string; values: unknown[] }[] {
  return method.mock.calls.map((statement) => dialect.compile(statementOf(statement)));
}
