import type { BoundStatement } from '../type/index.js';
import { cachedIn, noop } from '../util/object.util.js';
import type { PgResult } from './pgExecution.js';

/** What a pipeline writes to besides the statements its `Query` writes: the `Sync` closing the request. */
type PgConnection = { sync(): void };

/** What decodes a column, as node-postgres reads its wire types off a client: `client.getTypeParser`. */
export type PgTypes = { getTypeParser(oid: number, format?: 'text' | 'binary'): unknown };

/** Answered with an error, or on success with each statement's result: one alone, else a list. */
type PgQueryCallback = (error: Error | null, results: PgResult | PgResult[]) => void;

/** node-postgres' `Query`, as a pipeline extends it: the one the client runs, so it reads the client's protocol. */
interface PgQuery {
  text: string;
  values?: readonly unknown[];
  submit(connection: object): unknown;
  requiresPreparation(): boolean;
  prepare(connection: PgConnection): void;
  handleCommandComplete(msg: unknown, connection: PgConnection): void;
  handleError(error: Error, connection: PgConnection): void;
}

type PgQueryClass = new (config: { text: string; callback: PgQueryCallback; types: PgTypes }) => PgQuery;

/** A client running statements, `pg`'s or a fork's, which names its `Query` on its class. */
export type PgPipelineClient = PgTypes & {
  query(text: string, values?: unknown[]): Promise<PgResult>;
  query(query: PgQuery): unknown;
};

const PIPELINES = new WeakMap<PgQueryClass, ReturnType<typeof pipelineOf>>();

/**
 * Runs `statements` on `client` in one round trip: each one's Parse, Bind and Execute, then a single `Sync`, so the
 * server answers them in order and fails the list at its first error, skipping the rest. A client whose `Query` cannot
 * be pipelined, as pg-native's, runs them in turn. The error names the statement that failed as `statementIndex`,
 * counted from the first after the `leading` ones the caller added.
 */
export function pipelined(
  client: PgPipelineClient,
  statements: readonly BoundStatement[],
  leading = 0,
): Promise<PgResult[]> {
  const Query: unknown = Reflect.get(client.constructor, 'Query');
  if (!pipelines(Query)) {
    return inTurn(client, statements, leading);
  }
  const Pipeline = cachedIn(PIPELINES, Query, () => pipelineOf(Query));
  return new Promise((resolve, reject) => {
    client.query(
      new Pipeline(statements, client, leading, (error, results) =>
        error ? reject(error) : resolve([results].flat()),
      ),
    );
  });
}

/** Whether `value` is a `Query` writing its statement's protocol itself, as `pg`'s does, which a pipeline extends. */
function pipelines(value: unknown): value is PgQueryClass {
  return typeof value === 'function' && typeof value.prototype?.prepare === 'function';
}

/** `statements` one round trip each, the error naming its statement as {@link pipelined}'s does. */
async function inTurn(
  client: PgPipelineClient,
  statements: readonly BoundStatement[],
  leading: number,
): Promise<PgResult[]> {
  const results: PgResult[] = [];
  for (const [at, { sql, values }] of statements.entries()) {
    const result = await client.query(sql, [...values]).catch((error: Error) => {
      throw Object.assign(error, { statementIndex: at - leading });
    });
    results.push(result);
  }
  return results;
}

/**
 * The pipeline over `Query`: it writes each statement as `Query` does, holding back each one's `Sync` but the last.
 * Earlier than `pg` 8.5 a failed list crashes the client, hence the peer floor. `pg` 8.23's public `pipeline` option
 * does not fit yet: it is set per client, and refuses the cursors a stream reads.
 */
function pipelineOf(Query: PgQueryClass) {
  return class Pipeline extends Query {
    readonly #statements: readonly BoundStatement[];
    readonly #leading: number;
    /** The statements the server finished, which is the position of one it fails. */
    #completed = 0;
    /** The statement being written, which is the one failing where its values cannot be. */
    #writing: number | undefined;
    #failed = false;

    /** `types`, the client's own, so every statement's rows decode as one run alone would, on a fork too. */
    constructor(statements: readonly BoundStatement[], types: PgTypes, leading: number, callback: PgQueryCallback) {
      super({ text: statements[0]!.sql, callback, types });
      this.#statements = statements;
      this.#leading = leading;
    }

    override requiresPreparation(): boolean {
      return true;
    }

    override prepare(connection: PgConnection): void {
      // `Query` closes each statement it writes with a `Sync`, which would commit it alone: the list sends one, last.
      const held: PgConnection = Object.create(connection, { sync: { value: noop } });
      for (const [at, { sql, values }] of this.#statements.entries()) {
        this.#writing = at;
        this.text = sql;
        this.values = values;
        super.prepare(held);
        if (this.#failed) {
          break;
        }
      }
      this.#writing = undefined;
      connection.sync();
    }

    override handleCommandComplete(msg: unknown, connection: PgConnection): void {
      this.#completed++;
      super.handleCommandComplete(msg, connection);
    }

    override handleError(error: Error, connection: PgConnection): void {
      this.#failed = true;
      const statementIndex = (this.#writing ?? this.#completed) - this.#leading;
      super.handleError(Object.assign(error, { statementIndex }), connection);
    }
  };
}
