import { getMeta, idOf, namesKey, relationOf } from '../entity/index.js';
import type { KeyedRow } from '../entity/metadata/definition.js';

import type { AbstractDialect } from '../dialect/abstractDialect.js';
import { namesRows } from '../dialect/operators.js';
import type {
  BooleanLike,
  CursorPage,
  EntityData,
  EntityId,
  EntityWrite,
  EntityMeta,
  ExtraOptions,
  FieldKey,
  IdKey,
  HookEvent,
  Querier,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryFilter,
  QueryFindResult,
  QueryGroupMap,
  QueryKeyset,
  QueryKeysetProjected,
  QueryOne,
  QueryOneProjected,
  QueryOptions,
  QueryPage,
  QueryPopulate,
  QueryProjected,
  QuerySearch,
  PrimaryKey,
  RelationKey,
  RelationMeta,
  RelationQuery,
  SavepointCommand,
  TransactionOptions,
  Type,
  UpdatePayload,
  UpdateWrite,
  ReturningResult,
  WriteOptions,
  WrittenId,
} from '../type/index.js';
import { parseQueryLock } from '../type/index.js';
import {
  childrenExcept,
  childrenOf,
  chunk,
  clone,
  entityName,
  fillOnFields,
  filterFieldKeys,
  forEachRequestedRelation,
  getKeys,
  hasKeys,
  getRelationRequestSummary,
  guardWrite,
  idOnlyQuery,
  keyJoins,
  keySet,
  isPagedQuery,
  isScalarId,
  LoggerWrapper,
  normalizeScalarFieldSelection,
  parentJoins,
  pointAt,
  queryLoggerFor,
  parseRelationAtKey,
  parseRelationQueryValue,
  rowKey,
  runHooks,
  securityConditions,
  someKey,
  targetJoins,
  whereEach,
  whereIds,
  whereKeysIn,
  whereWith,
  withoutSoftDeleteFilter,
  cascadingRelations,
  holdsForeignKey,
} from '../util/index.js';
import { UqlOptimisticLockError, UqlUsageError } from '../util/uqlError.js';
import { keysetRead } from './keyset.js';
import { enrichError } from './queryError.js';
import {
  awaitTurn,
  claim,
  currentTransaction,
  depthOf,
  free,
  inTransaction,
  newScope,
  slotOf,
  type TransactionScope,
  type TransactionSlot,
} from './transaction.js';

/**
 * Refuses a nullish id, which would reduce to no filter at all, and a composite id missing a column,
 * which would address every row agreeing on the rest. Callers are `async`, so it always rejects.
 */
function assertIdValue<E>(entity: Type<E>, id: EntityId<E>): void {
  if (id === undefined || id === null) {
    throw new UqlUsageError(`'${entity.name}' was addressed by id, but the id is ${String(id)}`);
  }
  if (isScalarId(id)) {
    // One value names one column, which `whereIds` refuses on a composite.
    return;
  }
  // Every key, or the `$where` names only some of the columns and addresses each row that agrees on
  // those - which for an update or a delete is silently far more than the one row asked for. `{}`
  // reaches here too, and would otherwise be an unfiltered statement over the whole table.
  const given: { readonly [K in IdKey<E>]?: unknown } = id;
  const { ids } = getMeta(entity);
  const missing = ids.filter((key) => given[key] == null);
  if (missing.length) {
    throw new UqlUsageError(
      `'${entity.name}' is addressed by an object carrying every key of its primary key (${ids.join(', ')}); missing ${missing.join(', ')}.`,
    );
  }
}

/**
 * A bulk write names the rows it changes: a `$where`, or a `$limit` capping how many it reaches. The
 * caller's own clauses are what count - a filter the entity adds, soft delete's, would otherwise make
 * every table look narrowed, which is the case this exists to catch.
 */
function assertNamesRows<E>(entity: Type<E>, method: string, q: QuerySearch<E> | undefined, opts?: QueryOptions): void {
  if (opts?.unfiltered || namesRows(q?.$where) || q?.$limit !== undefined) {
    return;
  }
  throw new UqlUsageError(
    `'${method}' over '${entity.name}' names no rows, so it would address every one: pass '{ unfiltered: true }' to mean it`,
  );
}

/**
 * An optimistic lock as one update applies it: the version the payload carried, the one that replaces
 * it, and the filter pinning what the column still holds. The bump is a plain value rather than SQL
 * arithmetic, since that filter already pins it, which spares every engine a read-back.
 */
function lockVersion<E extends object>(
  meta: EntityMeta<E>,
  key: FieldKey<E>,
  q: QuerySearch<E>,
  row: UpdatePayload<E>,
): { readonly expected: number | bigint; readonly next: number | bigint; readonly q: QuerySearch<E> } {
  const expected = row[key];
  if (typeof expected !== 'number' && typeof expected !== 'bigint') {
    throw new UqlUsageError(
      `an update of '${entityName(meta)}' carries no '${key}': a versioned row is written against the version it was read at`,
    );
  }
  const next = typeof expected === 'bigint' ? expected + 1n : expected + 1;
  // Spread, as every other added predicate here is: one flat `AND`, and a caller already filtering on
  // the version contradicts itself into matching nothing, which is what they asked for.
  return { expected, next, q: { ...q, $where: whereWith(key, expected, q.$where) } };
}

/**
 * Refuses a write that cannot carry the lock, rather than writing over whatever the row holds now.
 * An upsert has no portable way to match a version - MySQL's `ON DUPLICATE KEY UPDATE` takes no
 * `WHERE` - and a write the library itself composes has no version to carry.
 */
function assertUnversioned<E extends object>(meta: EntityMeta<E>, what: string): void {
  if (meta.version) {
    throw new UqlUsageError(
      `cannot ${what} the versioned '${entityName(meta)}': it carries no '${meta.version}' to match, so update it by id`,
    );
  }
}

/**
 * What a versioned update has to be for its lock to hold: one row, named by its id, written by one
 * statement. A filter naming more than one row cannot say which of them the payload's single version
 * belongs to, and anything settled first - a page, a relation write, a filter an engine cannot read in
 * an `UPDATE` - reads the ids and writes them separately, putting the race back in the gap between.
 */
function assertLockableUpdate<E extends object>(meta: EntityMeta<E>, q: QuerySearch<E>, settles: boolean): void {
  const where: KeyedRow<E> = { ...q.$where };
  const namesOneRow = meta.ids.every((key) => where[key] !== undefined && isScalarId(where[key]));
  if (!namesOneRow || settles) {
    throw new UqlUsageError(
      `cannot update '${entityName(meta)}' this way: a versioned row is matched and written in one statement, so it is named by its ${meta.ids.map((id) => `'${id}'`).join(', ')}, takes no '$sort', '$limit' or '$skip', writes no relation, and filters by none`,
    );
  }
}

/**
 * The id each written row is named by, in payload order. Read off the rows as written, so a key the
 * database generated or the ORM filled is there, and a composite is named by every column of it.
 */
function writtenIds<E>(meta: EntityMeta<E>, rows: EntityData<E>[]): (WrittenId<E> | undefined)[] {
  return rows.map((row) => (namesKey(meta, row) ? idOf(meta, row) : undefined));
}

/**
 * Whether an upsert has to read before it writes: `ON CONFLICT` updates a guarded row whatever tenant it belongs
 * to, and writes no relation.
 */
function upsertsByReading<E extends object>(
  meta: EntityMeta<E>,
  rows: readonly E[],
  update: UpdatePayload<E> | undefined,
): boolean {
  return securityConditions(meta).length > 0 || writesRelations(meta, update ? [...rows, update] : rows);
}

/** What `ON CONFLICT` assigns a row it finds by default: the payload, less the columns it matched on. */
function conflictAssignments<E>(row: EntityData<E>, conflictPaths: QueryConflictPaths<E>): EntityData<E> {
  const assigned = { ...row };
  for (const key of getKeys(conflictPaths)) {
    delete assigned[key];
  }
  return assigned;
}

/**
 * Writes the key an upsert reported onto each row that named none - only the key, since an `onInsert`
 * value was never written to a row the upsert updated. A report aligns with the rows only when it
 * speaks for every one: a `firstId` dialect reports nothing for a batch.
 */
function adoptReportedIds<E>(
  meta: EntityMeta<E>,
  rows: EntityData<E>[],
  reported: readonly (PrimaryKey | undefined)[] | undefined,
): void {
  if (meta.ids.length !== 1 || reported?.length !== rows.length) {
    return;
  }
  const [idKey] = meta.ids;
  for (let index = 0; index < rows.length; index++) {
    rows[index][idKey] ??= reported[index] as E[typeof idKey];
  }
}

/** A read's arguments in either call form: `(entity, q, opts)` or `({ $entity, ...q }, opts)`. */
type EntityArgs<E, Q> =
  | [entity: Type<E>, q?: Q, opts?: QueryOptions]
  | [q: Q & { $entity: Type<E> }, opts?: QueryOptions];

/** Normalizes either call form to `[entity, query, opts]`, throwing when a query object has no `$entity`. */
function entityArgs<E, Q extends object>(args: EntityArgs<E, Q>): [Type<E>, Q, QueryOptions | undefined] {
  if (isEntityFirst(args)) {
    const [entity, q, opts] = args;
    return [entity, q ?? ({} as Q), opts];
  }
  const [{ $entity, ...q }, opts] = args;
  if (!$entity) {
    throw new UqlUsageError('$entity is required when using query-object syntax');
  }
  return [$entity, q as Q, opts];
}

/** Whether the entity is passed first, i.e. the first argument is a class rather than a query object. */
function isEntityFirst<E, Q>(args: EntityArgs<E, Q>): args is [entity: Type<E>, q?: Q, opts?: QueryOptions] {
  const [first] = args;
  return typeof first === 'function' && first.prototype !== undefined;
}

/** The fields `returning` projects, read as `$select` is, or `undefined` where it names none: the write reads nothing back. */
function returnedKeys<E>(
  meta: EntityMeta<E>,
  returning: WriteOptions<E, FieldKey<E>, BooleanLike>['returning'],
): FieldKey<E>[] | undefined {
  return hasKeys(returning) ? normalizeScalarFieldSelection(meta, returning) : undefined;
}

/** How a delete reads the rows it removes: a hard one takes already-soft-deleted rows too, so it has to see them. */
function deletableRows(opts: QueryOptions | undefined): QueryOptions | undefined {
  return opts?.hardDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts;
}

/** `row` with only the fields `keys` names. */
function pickFields<E>(row: E, keys: readonly FieldKey<E>[]): Partial<E> {
  const picked: Partial<E> = {};
  for (const key of keys) {
    picked[key] = row[key];
  }
  return picked;
}

/** A parent's id and the value it writes into one of its relations. */
type RelationWrite<E> = { readonly id: EntityId<E>; readonly value: unknown };

/** Whether any payload writes a relation it cascades to, which makes the write several statements. */
function writesRelations<E>(meta: EntityMeta<E>, payloads: readonly object[]): boolean {
  const keys = cascadingRelations(meta, 'persist');
  return payloads.some((payload) => keys.some((key) => Object.hasOwn(payload, key)));
}

/** The relations a write cascades to whose rows hold the parent's key: written after the parent, by its id. */
function ownedRelations<E>(meta: EntityMeta<E>): RelationKey<E>[] {
  return cascadingRelations(meta, 'persist').filter((relKey) => !holdsForeignKey(relationOf(meta, relKey)));
}

/** A relation's value as the rows it lists: a to-many's list, a to-one's row, none for `null`. */
function listedRows(value: unknown): object[] {
  return value == null ? [] : Array.isArray(value) ? value : [value as object];
}

/** What a savepoint the querier names is called, its depth appended. */
const SAVEPOINT_PREFIX = '_uql_sp';

/** Runs the callbacks a transaction gathered for its commit, in the order they were registered. */
async function runCallbacks(callbacks: readonly (() => unknown)[]): Promise<void> {
  for (const callback of callbacks) {
    await callback();
  }
}

const STREAM_HOLDS_QUERIER =
  'a stream is reading on this querier: run the statement after its loop, or on another querier';

/** Base class for all database queriers. */
export abstract class AbstractQuerier implements Querier {
  /** The last task {@link serialize} queued, which the next one runs after. */
  private taskQueue: Promise<unknown> = Promise.resolve();

  /** The stream reading on the connection, from its first row asked for until its loop ends. */
  #stream?: AsyncGenerator<unknown>;

  /**
   * A querier is one unit of work, so releasing ends it. Checked where each backend reaches for its
   * connection, on every driver and not just the pooled ones.
   */
  protected released = false;
  protected readonly logger: LoggerWrapper;
  abstract readonly dialect: AbstractDialect;

  /**
   * The connection is in a state nothing here can name, so `release` discards it rather than hand it back: a
   * rollback or a stream's close failed. The one place that decision is kept, whichever failure made it.
   */
  #unusable = false;

  constructor(readonly extra?: ExtraOptions) {
    this.logger = queryLoggerFor(extra);
  }

  /**
   * What the transaction this querier opens belongs to: the querier itself, its own connection, unless every
   * querier of its pool is one session (SQLite, PGlite), whose queriers then name that handle and share it.
   */
  protected get connection(): object {
    return this;
  }

  #connectionSlot?: TransactionSlot;

  /**
   * The transaction the connection holds, which every querier on it reads: the querier's own where it owns
   * its connection, and the shared session's otherwise, the one case the registry exists for.
   */
  get #slot(): TransactionSlot {
    return (this.#connectionSlot ??= this.connection === this ? {} : slotOf(this.connection));
  }

  /** What every read is checked for before it runs, whichever backend runs it. */
  protected validateReadQuery<E extends object>(entity: Type<E>, q: Query<E>): void {
    this.assertLockable(entity, q);
    this.validateProjectionQueryRecursive(entity, q, entityName(getMeta(entity)));
  }

  /**
   * Refuses a `$lock` the engine cannot take, then one outside a transaction, where the lock would
   * drop as the statement commits: only the querier knows whether one is open. Here rather than in
   * each backend's read, so the rule reaches a find, a stream and a paged count alike.
   */
  private assertLockable<E extends object>(entity: Type<E>, q: Query<E>): void {
    if (!parseQueryLock(q.$lock)) {
      return;
    }
    this.dialect.assertLockSupported(entity, q);
    if (!this.scopeHere()) {
      throw new UqlUsageError('$lock requires an open transaction');
    }
  }

  private validateProjectionQueryRecursive<E extends object>(
    entity: Type<E>,
    q: Query<E> | RelationQuery<E>,
    path: string,
  ): void {
    const meta = getMeta(entity);
    if (q.$select && q.$exclude) {
      for (const [key, value] of Object.entries(q.$select)) {
        if (key in meta.fields && value) {
          throw new UqlUsageError(
            `Cannot combine $select and $exclude when $select includes positive scalar fields (${key}) at ${path}. Use either $select (whitelist) or $exclude (subtractive) in a single query.`,
          );
        }
      }
    }
    forEachRequestedRelation(meta, q.$populate, (relKey, relValue) => {
      const relOpts = relationOf(meta, relKey);
      type Related = InstanceType<ReturnType<typeof relOpts.entity>>;
      const relEntity = relOpts.entity();
      const parsed = parseRelationQueryValue<Related>(relValue);
      if (parsed.nested) {
        this.validateProjectionQueryRecursive(relEntity, parsed.query, `${path}.${relKey}`);
      }
    });
  }

  findOneById<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    id: EntityId<E>,
    q?: QueryOneProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C> | undefined>;
  async findOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    q: QueryOne<E> = {},
    opts?: QueryOptions,
  ): Promise<E | undefined> {
    assertIdValue(entity, id);
    return this.findOne(entity, { ...q, $where: { ...q.$where, ...whereIds(getMeta(entity), id) } }, opts);
  }

  /** Find one record, the entity passed first or as the query's `$entity`. */
  async findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    q: QueryOneProjected<E, S, V, X, P, C> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C> | undefined>;
  async findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryOneProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C> | undefined>;
  async findOne<E extends object>(...args: EntityArgs<E, QueryOne<E>>): Promise<E | undefined> {
    const [entity, q, opts] = entityArgs(args);
    const rows = await this.findMany(entity, { ...q, $limit: 1 }, opts);
    return rows[0];
  }

  /** Find many records, the entity passed first or as the query's `$entity`. */
  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    q: QueryProjected<E, S, V, X, P, C> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C>[]>;
  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C>[]>;
  async findMany<E extends object>(...args: EntityArgs<E, Query<E>>): Promise<E[]> {
    const [entity, q, opts] = entityArgs(args);
    this.validateReadQuery(entity, q);
    const founds = await this.internalFindMany(entity, q, opts);
    // Guarded here rather than only inside: awaiting a call that returns at once still costs every read
    // a promise and a turn of the microtask queue, and most reads hook nothing.
    if (this.listensForLoad(entity, q.$populate)) {
      await this.emitLoaded(entity, founds, q.$populate);
    }
    return founds;
  }

  /**
   * The rows matching `q`, each populated relation and `$count` read with them in the same statement
   * or pipeline. [The design](../../../../architecture/relations-in-one-statement.md).
   */
  protected abstract internalFindMany<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): Promise<E[]>;

  /**
   * Stream records with the relations and counts `findMany` reads, the entity passed first or as `$entity`.
   * `afterLoad` runs on each row as it arrives, and the querier runs nothing else until the loop ends.
   */
  findManyStream<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    q: QueryProjected<E, S, V, X, P, C> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, S, V, X, P, C>>;
  findManyStream<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): AsyncIterable<QueryFindResult<E, S, V, X, P, C>>;
  findManyStream<E extends object>(...args: EntityArgs<E, Query<E>>): AsyncIterable<E> {
    const [entity, q, opts] = entityArgs(args);
    this.validateReadQuery(entity, q);
    const loaded = this.listensForLoad(entity, q.$populate)
      ? (row: E) => this.emitLoaded(entity, [row], q.$populate)
      : undefined;
    return this.holdWhileReading(this.internalFindManyStream(entity, q, opts), loaded);
  }

  /**
   * `rows`, each through `loaded` (guarded, so an unhooked row costs no turn) before the loop sees it, holding the
   * querier from the first row asked for until the loop ends. Most drivers queue a statement behind an open read,
   * which a loop awaiting it never finishes, so `serialize` refuses one meanwhile, and `release` closes the stream.
   */
  private holdWhileReading<T>(rows: AsyncIterable<T>, loaded?: (row: T) => Promise<void>): AsyncGenerator<T> {
    const read = async function* (querier: AbstractQuerier): AsyncGenerator<T> {
      if (querier.#stream) {
        throw new UqlUsageError(STREAM_HOLDS_QUERIER);
      }
      querier.#stream = stream;
      try {
        await querier.taskQueue;
        await querier.#turn();
        for await (const row of rows) {
          if (loaded) {
            await loaded(row);
          }
          yield row;
        }
      } finally {
        querier.#stream = undefined;
      }
    };
    const stream = read(this);
    return stream;
  }

  protected abstract internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): AsyncIterable<E>;

  /** Find many records and count every match, the entity passed first or as the query's `$entity`. */
  findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    q: QueryProjected<E, S, V, X, P, C> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, S, V, X, P, C>[], number]>;
  findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, S, V, X, P, C>[], number]>;
  async findManyAndCount<E extends object>(...args: EntityArgs<E, Query<E>>): Promise<[E[], number]> {
    const [entity, q, opts] = entityArgs(args);
    this.validateReadQuery(entity, q);
    const [founds, count] = await this.internalFindManyAndCount(entity, q, opts);
    if (this.listensForLoad(entity, q.$populate)) {
      await this.emitLoaded(entity, founds, q.$populate);
    }
    return [founds, count];
  }

  /**
   * The page and how many rows the filter matched beyond it. Two statements here, which is what a
   * backend with no way to answer both at once is left with; SQL overrides it to answer from one.
   */
  protected async internalFindManyAndCount<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): Promise<[E[], number]> {
    return Promise.all([
      this.internalFindMany(entity, q, opts),
      this.internalCount(entity, { $where: q.$where }, opts),
    ]);
  }

  /** Read a page of records from a cursor, the entity passed first or as the query's `$entity`. */
  findManyPage<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    q: QueryKeysetProjected<E, S, V, X, P, C> & { $entity: Type<E> },
    opts?: QueryOptions,
  ): Promise<CursorPage<QueryFindResult<E, S, V, X, P, C>>>;
  findManyPage<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryKeysetProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<CursorPage<QueryFindResult<E, S, V, X, P, C>>>;
  /**
   * Shared by every backend: the keyset condition is an ordinary `$where`, so each engine renders it with the
   * operators it already has, and the page holds the rows `findMany` would return.
   */
  async findManyPage<E extends object>(...args: EntityArgs<E, QueryKeyset<E>>): Promise<CursorPage<E>> {
    const [entity, q, opts] = entityArgs(args);
    this.validateReadQuery(entity, q);
    const read = keysetRead(getMeta(entity), q, this.dialect.features.nullsSortLowest);
    const page = read.page(await this.internalFindMany(entity, read.query, opts));
    if (this.listensForLoad(entity, q.$populate)) {
      await this.emitLoaded(entity, page.items, q.$populate);
    }
    return page;
  }

  /** Count records matching the query, the entity passed first or as the query's `$entity`. */
  count<E extends object>(q: QueryPage<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  count<E extends object>(entity: Type<E>, q?: QueryPage<E>, opts?: QueryOptions): Promise<number>;
  async count<E extends object>(...args: EntityArgs<E, QueryPage<E>>): Promise<number> {
    const [entity, q, opts] = entityArgs(args);
    return this.internalCount(entity, q, opts);
  }

  /** How many rows match, or how many of them a page takes: counted where they are, never read. */
  protected abstract internalCount<E extends object>(
    entity: Type<E>,
    q: QueryPage<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  /** Whether anything matches, the entity passed first or as `$entity`: a count capped at one row. */
  exists<E extends object>(q: QueryFilter<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<boolean>;
  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: QueryOptions): Promise<boolean>;
  async exists<E extends object>(...args: EntityArgs<E, QueryFilter<E>>): Promise<boolean> {
    const [entity, q, opts] = entityArgs(args);
    return (await this.internalCount(entity, { $where: q.$where, $limit: 1 }, opts)) > 0;
  }

  /**
   * Run an aggregate query.
   */
  aggregate<E extends object, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return this.internalAggregate(entity, q, opts);
  }

  protected abstract internalAggregate<E extends object, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]>;

  /** Abstract outright: nothing is shared to do around it. See {@link UniversalQuerier.estimatedCount}. */
  abstract estimatedCount<E extends object>(entity: Type<E>): Promise<number>;

  insertOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, WrittenId<E> | undefined, QueryFindResult<E, S, V>>>;
  async insertOne<E extends object>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, FieldKey<E>, BooleanLike>,
  ) {
    const [written] = await this.writeReturning(entity, () => this.insertIds(entity, [payload]), opts);
    return written;
  }

  insertMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, (WrittenId<E> | undefined)[], QueryFindResult<E, S, V>[]>>;
  async insertMany<E extends object>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, FieldKey<E>, BooleanLike>,
  ) {
    return this.writeReturning(entity, () => this.insertIds(entity, payload), opts);
  }

  /**
   * The ids of the rows inserted, in payload order. The `onInsert` values are filled before the write, so
   * the after hooks and the ids read the same rows the statement wrote.
   */
  private async insertIds<E extends object>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
  ): Promise<(WrittenId<E> | undefined)[]> {
    if (!payload.length) {
      return [];
    }
    const meta = getMeta(entity);
    const insert = () =>
      this.hooked(entity, 'Insert', payload, async (rows) => {
        await this.insertRows(entity, rows);
        return writtenIds(meta, rows);
      });
    return writesRelations(meta, payload) ? this.atomically(insert) : insert();
  }

  /**
   * The ids `write` reports, or, where `opts` asks for `returning`, the rows they name, read back in the same
   * transaction with only the fields it lists.
   */
  private writeReturning<E extends object>(
    entity: Type<E>,
    write: () => Promise<(WrittenId<E> | undefined)[]>,
    opts: WriteOptions<E, FieldKey<E>, BooleanLike> | undefined,
  ): Promise<(WrittenId<E> | undefined)[] | Partial<E>[]> {
    const keys = returnedKeys(getMeta(entity), opts?.returning);
    return keys ? this.atomically(async () => this.readWritten(entity, await write(), keys)) : write();
  }

  /** The rows `q` matches with the fields `keys` names and their keys, through `afterLoad` as a read's are. */
  private async readReturning<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    keys: readonly FieldKey<E>[],
    opts?: QueryOptions,
  ): Promise<E[]> {
    const $select = keySet<E>([...keys, ...getMeta(entity).ids]);
    const rows = await this.internalFindMany(entity, { ...q, $select }, opts);
    if (this.hasHook(entity, 'afterLoad')) {
      await this.emitHook(entity, 'afterLoad', rows);
    }
    return rows;
  }

  /** The rows `ids` names, in their order, each with only the fields `keys` names. */
  private async readWritten<E extends object>(
    entity: Type<E>,
    ids: readonly (EntityId<E> | undefined)[],
    keys: readonly FieldKey<E>[],
    opts?: QueryOptions,
  ): Promise<Partial<E>[]> {
    const meta = getMeta(entity);
    const known = ids.filter((id) => id !== undefined);
    if (known.length < ids.length) {
      throw new UqlUsageError(
        `'returning' reads each written '${entity.name}' back by its key, which ${this.dialect.dialectName} did not report for every row: give the rows their own keys`,
      );
    }
    if (!known.length) {
      return [];
    }
    // The rows this write wrote, whatever a filter says of them: a soft-deleted one inserted is still written.
    const read = { ...opts, filters: withoutSoftDeleteFilter(opts?.filters) };
    const rows: E[] = [];
    for (const batch of chunk(known, this.dialect.keyListCapacity(meta.ids.length))) {
      rows.push(...(await this.readReturning(entity, { $where: whereIds(meta, batch) }, keys, read)));
    }
    const byKey = new Map(rows.map((row) => [rowKey(row, meta.ids), row]));
    return known.flatMap((id) => {
      const row = byKey.get(rowKey(whereIds(meta, id), meta.ids));
      return row ? [pickFields(row, keys)] : [];
    });
  }

  /**
   * Writes `rows` and their relations: the to-ones they hold the keys of first, so each row inserts
   * pointing at its own, then the rows, then their children by the keys the rows got. An insert, and the
   * insert half of a read upsert.
   */
  private async insertRows<E extends object>(entity: Type<E>, rows: EntityData<E>[]): Promise<void> {
    const meta = getMeta(entity);
    await this.writeHeldReferences(entity, rows);
    fillOnFields(meta, rows, 'onInsert');
    guardWrite(meta, rows, 'insert');
    await this.internalInsertMany(entity, rows);
    await this.insertChildren(entity, rows);
  }

  /** Writes `rows`, its columns only, and onto each one the key the database generated for it, where it can tell. */
  protected abstract internalInsertMany<E extends object>(entity: Type<E>, rows: EntityData<E>[]): Promise<void>;

  updateOneById<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V> | undefined>>;
  async updateOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, FieldKey<E>, BooleanLike>,
  ): Promise<unknown> {
    assertIdValue(entity, id);
    const updated = await this.updateWhere(entity, { $where: whereIds(getMeta(entity), id) }, payload, opts);
    return typeof updated === 'number' ? updated : updated[0];
  }

  updateMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V>[]>>;
  async updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, FieldKey<E>, BooleanLike>,
  ) {
    return this.updateWhere(entity, q, payload, opts);
  }

  /**
   * The number of rows the update changed, or the rows `returning` reads back: their ids settled first, so a
   * payload changing what `$where` reads still names them, and read back by those ids in the same transaction.
   */
  private async updateWhere<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions & WriteOptions<E, FieldKey<E>, BooleanLike>,
  ): Promise<number | Partial<E>[]> {
    assertNamesRows(entity, 'updateMany', q, opts);
    const meta = getMeta(entity);
    const { returning, ...rest } = opts ?? {};
    const keys = returnedKeys(meta, returning);
    if (!keys) {
      return this.updateMatching(entity, q, payload, opts);
    }
    return this.atomically(async () => {
      const ids = await this.settleIds(entity, q, rest);
      await this.updateMatching(entity, q, payload, rest);
      return this.readWritten(entity, ids, keys, rest);
    });
  }

  /** Updates the rows `q` matches between the update hooks, atomically where the payload writes relations too. */
  private updateMatching<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts: QueryOptions | undefined,
  ): Promise<number> {
    const meta = getMeta(entity);
    const update = () =>
      this.hooked(entity, 'Update', [payload], ([row]) => this.updateRows(entity, q, row, opts, meta.version));
    return writesRelations(meta, [payload]) ? this.atomically(update) : update();
  }

  /**
   * The write every update runs, matching the version `lockKey` names where one is being held. Only a
   * restore passes none: it writes no content, so there is no update of anyone's to lose.
   */
  private async updateRows<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    row: UpdatePayload<E>,
    opts: QueryOptions | undefined,
    lockKey: FieldKey<E> | undefined,
  ): Promise<number> {
    const meta = getMeta(entity);
    await this.writeHeldReferences(entity, [row]);
    fillOnFields(meta, [row], 'onUpdate');
    guardWrite(meta, [row], 'update');
    const relKeys = ownedRelations(meta).filter((key) => Object.hasOwn(row, key));
    const settles = !!relKeys.length || this.settlesWrite(entity, q);
    if (lockKey) {
      assertLockableUpdate(meta, q, settles);
      const lock = lockVersion(meta, lockKey, q, row);
      row[lockKey] = lock.next as E[FieldKey<E>];
      const changes = await this.updateColumns(entity, lock.q, row, opts, 0);
      return changes || this.throwStaleVersion(entity, lockKey, q, lock.expected, opts);
    }
    if (!settles) {
      return this.updateColumns(entity, q, row, opts, 0);
    }
    const ids = await this.settleIds(entity, q, opts);
    if (!ids.length) {
      return 0;
    }
    const changes = await this.writeBatches(ids, meta.ids.length, (batch) =>
      this.updateColumns(entity, { $where: whereIds(meta, batch) }, row, opts, batch.length),
    );
    for (const relKey of relKeys) {
      await this.replaceChildren(entity, relKey, ids, row[relKey]);
    }
    return changes;
  }

  /**
   * Why an update matched no row. The filter named the row by its id, so reading by that id alone
   * separates the three: the row is gone, another writer moved the version on, or the rest of the
   * filter excluded a row still at that version. One read, only on the failure, so the happy path
   * still costs one statement. Best effort by nature - the row can change again while we ask.
   */
  private async throwStaleVersion<E extends object>(
    entity: Type<E>,
    key: FieldKey<E>,
    q: QuerySearch<E>,
    expected: number | bigint,
    opts?: QueryOptions,
  ): Promise<never> {
    const meta = getMeta(entity);
    const row = await this.findOne(
      entity,
      { $select: keySet([key]), $where: whereIds(meta, idOf(meta, { ...q.$where })) },
      opts,
    );
    const actual = row?.[key];
    const message =
      actual === undefined
        ? `no row of '${entityName(meta)}' has that id any more: it is gone`
        : actual === expected
          ? `'${entityName(meta)}' is still at '${key}' ${String(actual)}: another condition of the update's '$where' excluded it`
          : `'${entityName(meta)}' moved on: the payload carries '${key}' ${String(expected)}, the row is at ${String(actual)}`;
    throw new UqlOptimisticLockError(message, expected, actual);
  }

  /** The UPDATE, skipped where the payload writes no column, reporting `unwritten` instead. */
  private async updateColumns<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    row: UpdatePayload<E>,
    opts: QueryOptions | undefined,
    unwritten: number,
  ): Promise<number> {
    const writes = filterFieldKeys(getMeta(entity), row, 'onUpdate').length > 0;
    return writes ? this.internalUpdateMany(entity, q, row, opts) : unwritten;
  }

  /**
   * Whether a write has to name the rows `q` matches by their ids: no engine pages or orders an update or
   * delete, and one without {@link DialectFeatures.correlatedWrites} cannot read a relation in its filter.
   */
  protected settlesWrite<E extends object>(entity: Type<E>, q: QuerySearch<E>): boolean {
    const { dialect } = this;
    return isPagedQuery(q) || (!dialect.features.correlatedWrites && dialect.constrainsRelations(entity, q.$where));
  }

  /**
   * `write` over `rows` in lists of as many as one statement names by `keyCount` keys, summing what each changed:
   * in one transaction where there are several, so a write split to fit the engine still lands whole.
   */
  protected async writeBatches<T>(
    rows: readonly T[],
    keyCount: number,
    write: (batch: T[]) => Promise<number>,
  ): Promise<number> {
    const batches = chunk(rows, this.dialect.keyListCapacity(keyCount));
    const each = async () => {
      let changes = 0;
      for (const batch of batches) {
        changes += await write(batch);
      }
      return changes;
    };
    return batches.length > 1 ? this.atomically(each) : each();
  }

  /** Runs a write of several statements as one: in a transaction of its own, or the one already open. */
  protected atomically<T>(write: () => Promise<T>): Promise<T> {
    return this.scopeHere() ? write() : this.transaction(write);
  }

  /** The ids `q` matches, in its own order and page. */
  protected async settleIds<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ): Promise<EntityId<E>[]> {
    const meta = getMeta(entity);
    const rows = await this.internalFindMany(entity, idOnlyQuery(meta, q), opts);
    return rows.map((row) => idOf(meta, row));
  }

  /** Runs one UPDATE over `q`, which names its rows by id wherever {@link updateMany} settled them. */
  protected abstract internalUpdateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  async restoreOneById<E extends object>(entity: Type<E>, id: EntityId<E>): Promise<number> {
    assertIdValue(entity, id);
    return this.restoreMany(entity, { $where: whereIds(getMeta(entity), id) });
  }

  async restoreMany<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number> {
    const meta = getMeta(entity);
    if (!meta.softDelete) {
      throw new UqlUsageError(`'${entity.name}' has not enabled 'softDelete'`);
    }
    const $where = whereWith(meta.softDelete, { $ne: null }, q.$where);
    // No version: a restore only undoes the stamp a delete left, which takes none either, and two of
    // them racing agree on the result anyway. A lock is for content, and a restore writes none.
    return this.unversionedUpdate(
      entity,
      { ...q, $where },
      { [meta.softDelete]: null },
      { filters: { softDelete: false } },
    );
  }

  /**
   * An update the library writes of its own, hooked as a caller's is but carrying no version: a restore's
   * cleared stamp, or a row pointed at the relation just inserted for it.
   */
  private unversionedUpdate<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: object,
    opts?: QueryOptions,
  ): Promise<number> {
    return this.hooked(entity, 'Update', [payload], ([row]) => this.updateRows(entity, q, row, opts, undefined));
  }

  upsertOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityWrite<E>,
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, WrittenId<E> | undefined, QueryFindResult<E, S, V>>>;
  async upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityWrite<E>,
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, FieldKey<E>, BooleanLike>,
  ): Promise<unknown> {
    const [written] = await this.upsertMany(entity, conflictPaths, [payload], update, opts);
    return written;
  }

  upsertMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: readonly EntityWrite<E>[],
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, (WrittenId<E> | undefined)[], QueryFindResult<E, S, V>[]>>;
  async upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: readonly EntityWrite<E>[],
    update?: UpdateWrite<E>,
    opts?: WriteOptions<E, FieldKey<E>, BooleanLike>,
  ) {
    const meta = getMeta(entity);
    assertUnversioned(meta, "'upsert'");
    // Fires `beforeUpsert`/`afterUpsert`: which branch a row takes is the database's to decide, so neither
    // the insert's nor the update's pair fits.
    const upsert = () =>
      this.hooked(entity, 'Upsert', payload, async (rows) => {
        const ids = upsertsByReading(meta, rows, update)
          ? await this.readThenUpsert(entity, conflictPaths, rows, update)
          : await this.internalUpsertMany(entity, conflictPaths, rows, update);
        adoptReportedIds(meta, rows, ids);
        return writtenIds(meta, rows);
      });
    return this.writeReturning(entity, upsert, opts);
  }

  /**
   * An upsert as a read, then writes: the rows the conflict names are read through the filters, those found update
   * as `updateMany` does and the rest insert, so either branch writes its relations and a guarded row stays its
   * tenant's. A row inserted concurrently fails on its key. See architecture/security-filter-writes.md.
   */
  private async readThenUpsert<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    rows: E[],
    update?: UpdatePayload<E>,
  ): Promise<(PrimaryKey | undefined)[]> {
    const meta = getMeta(entity);
    guardWrite(meta, rows, 'insert');
    if (!rows.length) {
      return [];
    }
    const keys = getKeys(conflictPaths);
    const write = async () => {
      const ids = await this.idsByConflict(entity, conflictPaths, rows);
      for (const [index, row] of rows.entries()) {
        // An empty `update` leaves a found row as it is, as `DO NOTHING` does.
        if (ids[index] !== undefined && (update === undefined || hasKeys(update))) {
          const q = { $where: whereEach(keys, (key) => row[key]) };
          // A copy each: the update fills its `onUpdate` fields into what it is handed.
          const assigned = update ? { ...update } : conflictAssignments(row, conflictPaths);
          await this.updateRows(entity, q, assigned, { filters: withoutSoftDeleteFilter(undefined) }, undefined);
        }
      }
      const inserts = rows.filter((_, index) => ids[index] === undefined);
      if (inserts.length) {
        await this.insertRows(entity, inserts);
      }
      // A found row's key is adopted by the caller; an inserted one carries the key its insert wrote.
      return ids;
    };
    return rows.length > 1 || writesRelations(meta, [...rows, ...(update ? [update] : [])])
      ? this.atomically(write)
      : write();
  }

  /** Upserts `payload`, answering each row's key in payload order where the engine reports every one. */
  protected abstract internalUpsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
    update?: UpdatePayload<E>,
  ): Promise<(PrimaryKey | undefined)[] | undefined>;

  deleteOneById<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    id: EntityId<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V> | undefined>>;
  async deleteOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    opts?: QueryOptions & WriteOptions<E, FieldKey<E>, BooleanLike>,
  ): Promise<unknown> {
    assertIdValue(entity, id);
    const deleted = await this.deleteWhere(entity, { $where: whereIds(getMeta(entity), id) }, opts);
    return typeof deleted === 'number' ? deleted : deleted[0];
  }

  /** Delete records matching the query, the entity passed first or as `$entity`; soft-deletes unless `opts.hardDelete`. */
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions & WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, number, QueryFindResult<E, S, V>[]>>;
  async deleteMany<E extends object>(...args: EntityArgs<E, QuerySearch<E>>): Promise<unknown> {
    const [entity, q, opts] = entityArgs(args);
    return this.deleteWhere(entity, q, opts);
  }

  /** The number of rows deleted, or the rows `returning` reads as they were, before the delete and in its transaction. */
  private async deleteWhere<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions & WriteOptions<E, FieldKey<E>, BooleanLike>,
  ): Promise<number | Partial<E>[]> {
    assertNamesRows(entity, 'deleteMany', q, opts);
    const meta = getMeta(entity);
    const { returning, ...rest } = opts ?? {};
    const keys = returnedKeys(meta, returning);
    if (!keys) {
      return this.deleteRows(entity, q, opts);
    }
    return this.atomically(async () => {
      const rows = await this.readReturning(entity, q, keys, deletableRows(rest));
      await this.deleteRows(entity, q, rest);
      return rows.map((row) => pickFields(row, keys));
    });
  }

  private async deleteRows<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number> {
    const meta = getMeta(entity);
    const cascades = cascadingRelations(meta, 'delete').length > 0;
    const watched = this.hasHook(entity, 'beforeDelete') || this.hasHook(entity, 'afterDelete');
    if (!watched && !cascades && !this.settlesWrite(entity, q)) {
      return this.internalDeleteMany(entity, q, opts);
    }
    const readOpts = deletableRows(opts);
    // A hook receives the rows themselves; the ids read off them name the same rows a second read might not.
    const doomed = watched ? await this.internalFindMany(entity, q, readOpts) : [];
    const ids = watched ? doomed.map((row) => idOf(meta, row)) : await this.settleIds(entity, q, readOpts);
    if (!ids.length) {
      return 0;
    }
    const remove = async () => {
      await this.emitHook(entity, 'beforeDelete', doomed);
      const changes = await this.writeBatches(ids, meta.ids.length, async (batch) => {
        // Children first: they hold the foreign key, which a schema without `ON DELETE CASCADE` enforces.
        if (cascades) {
          await this.deleteChildren(entity, batch, opts);
        }
        return this.internalDeleteMany(entity, { $where: whereIds(meta, batch) }, opts);
      });
      await this.emitHook(entity, 'afterDelete', doomed);
      return changes;
    };
    return cascades ? this.atomically(remove) : remove();
  }

  /** Runs one DELETE (or soft-delete stamp) over `q`, which names its rows by id wherever {@link deleteMany} settled them. */
  protected abstract internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  saveOne<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, WrittenId<E> | undefined, QueryFindResult<E, S, V>>>;
  async saveOne<E extends object>(
    entity: Type<E>,
    payload: EntityWrite<E>,
    opts?: WriteOptions<E, FieldKey<E>, BooleanLike>,
  ) {
    const [written] = await this.writeReturning(entity, () => this.saveIds(entity, [payload]), opts);
    return written;
  }

  saveMany<E extends object, const S extends FieldKey<E> = never, const V extends BooleanLike = true>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, S, V>,
  ): Promise<ReturningResult<S, (WrittenId<E> | undefined)[], QueryFindResult<E, S, V>[]>>;
  async saveMany<E extends object>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
    opts?: WriteOptions<E, FieldKey<E>, BooleanLike>,
  ) {
    return this.writeReturning(entity, () => this.saveIds(entity, payload), opts);
  }

  /**
   * Whether a row names its key decides its statement, never whether the row exists: a named row
   * upserts on that key, so a stale id is written rather than silently missed, and an unnamed one
   * inserts. A composite is always named. The hooks follow the statement: a named row fires the upsert pair.
   */
  private async saveIds<E extends object>(
    entity: Type<E>,
    payload: readonly EntityWrite<E>[],
  ): Promise<(WrittenId<E> | undefined)[]> {
    const meta = getMeta(entity);
    assertUnversioned(meta, "'save'");
    // Indexes, not rows: the result is reported in payload order so it can be zipped with what was
    // passed, which concatenating the branches did not do.
    const toInsert: number[] = [];
    const toUpsert: number[] = [];
    const ids: (WrittenId<E> | undefined)[] = new Array(payload.length);

    /** Whether the row carries anything its primary key does not - something to write. */
    const writesMoreThanItsKey = (row: EntityWrite<E>) =>
      someKey(row, (key) => !meta.ids.some((idKey) => idKey === key));

    for (let index = 0; index < payload.length; index++) {
      const it = payload[index];
      if (!namesKey(meta, it)) {
        toInsert.push(index);
      } else if (writesMoreThanItsKey(it)) {
        toUpsert.push(index);
      } else {
        // A row that names its key and carries nothing else is a *reference*, not a write - the
        // shape a to-many uses to link rows it did not author. Upserting it would stamp `onUpdate`
        // fields on a row the caller never asked to change, and create one that was meant to exist.
        ids[index] = idOf(meta, it);
      }
    }

    const write = async () => {
      if (toInsert.length) {
        const inserted = await this.insertIds(
          entity,
          toInsert.map((index) => payload[index]),
        );
        for (let position = 0; position < toInsert.length; position++) {
          ids[toInsert[position]] = inserted[position];
        }
      }
      if (toUpsert.length) {
        const conflictPaths = keySet<E>(meta.ids);
        const upserted = await this.upsertMany(
          entity,
          conflictPaths,
          toUpsert.map((index) => payload[index]),
        );
        for (let position = 0; position < toUpsert.length; position++) {
          ids[toUpsert[position]] = upserted[position];
        }
      }
    };

    await (toInsert.length && toUpsert.length ? this.atomically(write) : write());

    return ids;
  }

  /**
   * Writes the target of each to-one `rows` hold the key of, and points each row at its own: a row naming
   * only its key is a link and writes nothing, any other saves as `saveMany` does, and `null` clears the key.
   */
  private async writeHeldReferences<E extends object>(
    entity: Type<E>,
    rows: readonly UpdatePayload<E>[],
  ): Promise<void> {
    const meta = getMeta(entity);
    for (const relKey of cascadingRelations(meta, 'persist')) {
      const relOpts = relationOf(meta, relKey);
      const holding = rows.filter((row) => row[relKey] !== undefined);
      if (!holdsForeignKey(relOpts) || !holding.length) {
        continue;
      }
      const relMeta = getMeta(relOpts.entity());
      const pointing = holding.flatMap((row) => listedRows(row[relKey]).map((target) => ({ row, target })));
      const ids = await this.saveTargets(
        entity,
        relKey,
        pointing.map(({ target }) => target),
      );
      const columns = (target: Record<string, unknown>) =>
        Object.fromEntries(relOpts.references.map(({ local, foreign }) => [local, target[foreign] ?? null]));
      for (const row of holding) {
        Object.assign(row, columns({}));
      }
      pointing.forEach(({ row, target }, index) => {
        Object.assign(row, columns({ ...target, ...whereIds(relMeta, ids[index]) }));
      });
    }
  }

  /** Writes each inserted row's children, one set of statements per relation whatever the number of rows. */
  private async insertChildren<E extends object>(entity: Type<E>, rows: EntityData<E>[]): Promise<void> {
    const meta = getMeta(entity);
    for (const relKey of ownedRelations(meta)) {
      const writes = rows.flatMap((row) => (row[relKey] == null ? [] : [{ id: idOf(meta, row), value: row[relKey] }]));
      if (writes.length) {
        await this.saveChildren(entity, relKey, writes);
      }
    }
  }

  /**
   * Makes `value` the children of each parent `ids` names, which it owns: the rows it lists are saved,
   * keeping what each does not write, and the parent's other children (a junction's other links) go.
   */
  private async replaceChildren<E extends object>(
    entity: Type<E>,
    relKey: RelationKey<E>,
    ids: EntityId<E>[],
    value: unknown,
  ): Promise<void> {
    const relOpts = relationOf(getMeta(entity), relKey);
    await (relOpts.through
      ? this.replaceLinks(entity, relKey, relOpts, relOpts.through(), ids, listedRows(value))
      : this.replaceOwned(entity, relKey, relOpts, ids, value));
  }

  /** A many-to-many's links: the targets are saved, the parent's links to any other go, and the missing ones are added. */
  private async replaceLinks<E extends object>(
    entity: Type<E>,
    relKey: RelationKey<E>,
    relOpts: RelationMeta,
    holder: Type<object>,
    ids: EntityId<E>[],
    listed: readonly object[],
  ): Promise<void> {
    const keyCount = getMeta(entity).ids.length;
    const parents = parentJoins(relOpts, keyCount);
    const targets = targetJoins(relOpts, keyCount);
    const targetIds = await this.saveTargets(entity, relKey, listed);
    await this.writeBatches(ids, keyCount, (batch) =>
      this.deleteMany(
        holder,
        { $where: { ...childrenOf(parents, batch), ...(targetIds.length && childrenExcept(targets, targetIds)) } },
        { hardDelete: true },
      ),
    );
    if (!targetIds.length) {
      return;
    }
    const linked = await this.internalFindMany(holder, {
      $where: { $and: [childrenOf(parents, ids), childrenOf(targets, targetIds)] },
    });
    const columns = [...parents, ...targets].map(({ column }) => column);
    const has = new Set(linked.map((link) => rowKey(link, columns)));
    const links = ids.flatMap((id) =>
      targetIds.map((targetId) => ({ ...pointAt(parents, id), ...pointAt(targets, targetId) })),
    );
    await this.insertMany(
      holder,
      links.filter((link) => !has.has(rowKey(link, columns))),
    );
  }

  /** The rows a parent owns: those it does not list go, and the listed ones are saved pointing at it. */
  private async replaceOwned<E extends object>(
    entity: Type<E>,
    relKey: RelationKey<E>,
    relOpts: RelationMeta,
    ids: EntityId<E>[],
    value: unknown,
  ): Promise<void> {
    const keyCount = getMeta(entity).ids.length;
    const relEntity: Type<object> = relOpts.entity();
    const relMeta = getMeta(relEntity);
    const parents = parentJoins(relOpts, keyCount);
    const keptIds = listedRows(value)
      .filter((row) => namesKey(relMeta, row))
      .map((row) => idOf(relMeta, row));
    await this.writeBatches(ids, keyCount, (batch) =>
      this.deleteMany(relEntity, {
        $where: {
          ...childrenOf(parents, batch),
          ...(keptIds.length && childrenExcept(keyJoins(relMeta.ids), keptIds)),
        },
      }),
    );
    await this.saveChildren(
      entity,
      relKey,
      ids.map((id) => ({ id, value })),
    );
  }

  /** Writes each parent's children: rows pointed at their parent, or targets linked through the junction. */
  private async saveChildren<E extends object>(
    entity: Type<E>,
    relKey: RelationKey<E>,
    writes: readonly RelationWrite<E>[],
  ): Promise<void> {
    const meta = getMeta(entity);
    const relOpts = relationOf(meta, relKey);
    const parents = parentJoins(relOpts, meta.ids.length);
    // Each parent gets its own copies, so a row listed for two parents is written twice.
    const children = writes.flatMap(({ id, value }) => listedRows(value).map((row) => ({ id, row })));
    if (!children.length) {
      return;
    }
    if (!relOpts.through) {
      await this.saveMany(
        relOpts.entity(),
        children.map(({ id, row }) => ({ ...row, ...pointAt(parents, id) })),
      );
      return;
    }
    const targetIds = await this.saveTargets(
      entity,
      relKey,
      children.map(({ row }) => row),
    );
    const targets = targetJoins(relOpts, meta.ids.length);
    await this.insertMany(
      relOpts.through(),
      children.map(({ id }, index) => ({ ...pointAt(parents, id), ...pointAt(targets, targetIds[index]) })),
    );
  }

  /**
   * Saves the rows a relation points at, each one's id what the pointer needs: a MySQL batch mixing supplied and
   * generated keys cannot report it, so one it could not is refused rather than left pointing nowhere.
   */
  private async saveTargets<E extends object>(
    entity: Type<E>,
    relKey: RelationKey<E>,
    rows: readonly object[],
  ): Promise<WrittenId<object>[]> {
    const relEntity: Type<object> = relationOf(getMeta(entity), relKey).entity();
    const ids = await this.saveMany(relEntity, rows);
    if (ids.includes(undefined)) {
      throw new UqlUsageError(
        `'${relEntity.name}' rows saved through '${entity.name}.${relKey}' reported no id, so they cannot be pointed at. ` +
          'Insert them with their own ids, or save the relation in its own statement.',
      );
    }
    return ids.filter((id) => id !== undefined);
  }

  /**
   * Deletes the children of the parents `ids` names, as the parents go: a hard delete takes them all, a soft
   * delete stamps those that can be stamped and keeps the rest, junction links included, for a restore.
   * `EntityId` because a settled composite row is an object, which {@link childrenOf} reads each foreign key column out of.
   */
  private async deleteChildren<E extends object>(entity: Type<E>, ids: EntityId<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const soft = !!meta.softDelete && !opts?.hardDelete;
    for (const relKey of cascadingRelations(meta, 'delete')) {
      const relOpts = relationOf(meta, relKey);
      const target = relOpts.through ? relOpts.through() : relOpts.entity();
      if (soft && !getMeta(target).softDelete) {
        continue;
      }
      const $where = childrenOf(parentJoins(relOpts, meta.ids.length), ids);
      await this.deleteMany(target, { $where }, { ...opts, hardDelete: !soft });
    }
  }

  abstract readonly hasOpenTransaction: boolean;

  /**
   * The transaction this flow runs in on this connection, the innermost where they nest: the callback's,
   * or a `beginTransaction` of this querier's. `undefined` outside one, or inside another flow's.
   */
  protected scopeHere(): TransactionScope | undefined {
    const held = this.#slot.held;
    if (!held) {
      return undefined;
    }
    const current = currentTransaction();
    if (current?.slot === this.#slot) {
      return current;
    }
    return held.manual && held.scope.querier === this ? held.scope : undefined;
  }

  /**
   * Runs `callback` in a transaction. Inside one this flow already runs, it is a savepoint: its failure undoes
   * its own writes alone. A transaction another flow holds on this connection is waited for, never joined.
   */
  async transaction<T>(callback: () => Promise<T>, opts?: TransactionOptions): Promise<T> {
    const here = this.scopeHere();
    if (here) {
      return this.nested(here, callback);
    }
    const scope = newScope(this, this.#slot);
    const result = await inTransaction(scope, async () => {
      await this.open(scope, false, opts);
      try {
        const value = await callback();
        await this.close(true);
        return value;
      } catch (err) {
        // Reported rather than thrown: the error being unwound is the useful one.
        await this.rollbackTransaction().catch((rollbackErr: unknown) => {
          this.logger.logError('rollback failed', rollbackErr);
        });
        throw err;
      }
    });
    await runCallbacks(scope.onCommit);
    return result;
  }

  /** A transaction inside `parent`, after any other it runs: a savepoint where the engine has them. */
  private nested<T>(parent: TransactionScope, callback: () => Promise<T>): Promise<T> {
    const scope = newScope(this, this.#slot, parent);
    const run = parent.nested.then(() => inTransaction(scope, () => this.savepointed(scope, parent, callback)));
    parent.nested = run.catch(() => undefined);
    return run;
  }

  /** `callback` between a savepoint and its release, rolled back to it on failure, its `onCommit` callbacks kept only where it succeeds. */
  private async savepointed<T>(scope: TransactionScope, parent: TransactionScope, callback: () => Promise<T>) {
    const name = `${SAVEPOINT_PREFIX}${depthOf(scope)}`;
    await this.serialize(() => this.savepoint('open', name));
    try {
      const value = await callback();
      await this.serialize(() => this.savepoint('release', name));
      parent.onCommit.push(...scope.onCommit);
      return value;
    } catch (err) {
      await this.serialize(() => this.savepoint('rollback', name));
      throw err;
    }
  }

  /**
   * Opens, releases or rolls back to a savepoint, which a SQL engine overrides. Elsewhere (MongoDB) there is
   * none, so a transaction inside another is refused: it could not undo its own writes apart.
   */
  protected savepoint(_kind: SavepointCommand, _name: string): Promise<void> {
    return Promise.reject(
      new UqlUsageError(
        `${this.dialect.dialectName} has no savepoint to nest a transaction in another: run it on its own`,
      ),
    );
  }

  /**
   * Runs `callback` once the outermost transaction this flow is in commits, and dropped if it rolls back:
   * a mail sent for a row that never landed is not sent. With no transaction open it runs now.
   */
  async onCommit(callback: () => unknown): Promise<void> {
    const scope = this.scopeHere();
    if (scope) {
      scope.onCommit.push(callback);
      return;
    }
    await callback();
  }

  /** Waits for the connection's transaction, if another flow holds one, then opens `scope`'s on it. */
  private async open(scope: TransactionScope, manual: boolean, opts?: TransactionOptions): Promise<void> {
    await claim(this.#slot, scope, manual);
    try {
      await this.serialize(() => this.openTransaction(opts));
    } catch (err) {
      free(this.#slot);
      throw err;
    }
  }

  /** Whether the transaction its connection holds is this querier's. */
  private holds(): boolean {
    return this.#slot.held?.scope.querier === this;
  }

  /**
   * Commits, or rolls back, the transaction this querier holds, in turn on its connection. With none held a
   * rollback has nothing to do, and a commit refuses: a `release` inside the callback rolled it back.
   */
  private close(commit: boolean): Promise<void> {
    return this.serialize(async () => {
      if (this.holds()) {
        return this.end(commit);
      }
      if (commit) {
        throw new UqlUsageError('the querier was released inside its transaction, which rolled back');
      }
    });
  }

  /**
   * Commits, or rolls back, the transaction this querier holds. A commit that fails can leave it open (SQLite
   * answers `SQLITE_BUSY` and keeps it) for the rollback after it; a failed rollback ends it, leaving the
   * connection unusable.
   */
  private async end(commit: boolean): Promise<void> {
    try {
      if (this.hasOpenTransaction) {
        await this.endTransaction(commit);
      }
    } catch (err) {
      this.#unusable ||= !commit;
      throw err;
    } finally {
      if (!this.hasOpenTransaction) {
        free(this.#slot);
      }
    }
  }

  /** Whether anything at all - a global listener or the entity itself - handles `event`. */
  private hasHook<E extends object>(entity: Type<E>, event: HookEvent): boolean {
    return (
      this.extra?.listeners?.some((listener) => listener[event]) || (getMeta(entity).hooks?.[event]?.length ?? 0) > 0
    );
  }

  /** Whether an `afterLoad` listens on the entity a read returns or on any relation it populated. */
  private listensForLoad<E extends object>(entity: Type<E>, populate: QueryPopulate<E> | undefined): boolean {
    if (this.hasHook(entity, 'afterLoad')) {
      return true;
    }
    const meta = getMeta(entity);
    return getRelationRequestSummary(meta, populate).requestedKeys.some((relKey) =>
      this.listensForLoad(relationOf(meta, relKey).entity(), parseRelationAtKey(relKey, populate).query.$populate),
    );
  }

  /**
   * `afterLoad` for every row a read loaded, a populated relation's before the rows holding them, so a
   * parent's hook sees its children as their own hooks left them. Rows are walked only where a hook
   * listens.
   */
  private async emitLoaded<E extends object>(
    entity: Type<E>,
    rows: E[],
    populate: QueryPopulate<E> | undefined,
  ): Promise<void> {
    const meta = getMeta(entity);
    for (const relKey of getRelationRequestSummary(meta, populate).requestedKeys) {
      const relEntity = relationOf(meta, relKey).entity();
      const relPopulate = parseRelationAtKey(relKey, populate).query.$populate;
      if (this.listensForLoad(relEntity, relPopulate)) {
        // A to-many holds a list and a to-one a row, which `flatMap` takes alike; an absent one adds none.
        const loaded = rows.flatMap((row) => (row as Record<string, object | object[] | undefined>)[relKey] ?? []);
        await this.emitLoaded(relEntity, loaded, relPopulate);
      }
    }
    await this.emitHook(entity, 'afterLoad', rows);
  }

  /**
   * The ids of `rows`, read through the filters by the columns an upsert matches them on: after a
   * statement that could not report them in payload order, or before a guarded upsert. A row that no
   * read row matches, or that two do, keeps `undefined`: a missing id is honest where a guessed one is not.
   */
  protected async idsByConflict<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    rows: EntityData<E>[],
  ): Promise<(PrimaryKey | undefined)[]> {
    const meta = getMeta(entity);
    const [idKey] = meta.ids;
    const keys = getKeys(conflictPaths);
    // A null key never conflicts, so no row is read back for it, whether one key names the row or several.
    const named = rows.filter((row) => keys.every((key) => row[key] != null));
    const distinct = [...new Map(named.map((row) => [rowKey(row, keys), row])).values()];
    const found: E[][] = [];
    for (const batch of chunk(distinct, this.dialect.keyListCapacity(keys.length))) {
      const q: Query<E> = { $select: keySet([idKey, ...keys]), $where: whereKeysIn(keys, batch) };
      found.push(await this.internalFindMany(entity, q, { filters: withoutSoftDeleteFilter(undefined) }));
    }
    const byConflict = new Map<string, PrimaryKey | undefined>();
    for (const row of found.flat()) {
      const key = rowKey(row, keys);
      byConflict.set(key, byConflict.has(key) ? undefined : (row[idKey] as PrimaryKey));
    }
    return rows.map((row) => byConflict.get(rowKey(row, keys)));
  }

  /**
   * Runs `write` between the event's `before`/`after` pair. The before hooks get the caller's rows, so
   * what they assign is written; `write` and the after hooks get a copy, which by then carries what
   * the write filled in - a generated key, an `onInsert` value - without it landing on the caller's.
   */
  private async hooked<E extends object, T>(
    entity: Type<E>,
    event: 'Insert' | 'Update' | 'Upsert',
    payloads: readonly object[],
    write: (rows: E[]) => Promise<T>,
  ): Promise<T> {
    // The one place a write becomes the row the rest of the library handles. They are the same object:
    // a write is the entity's data without the keys the database fills, which TypeScript cannot relate
    // across an entity it has not resolved.
    const asRows = payloads as readonly E[];
    await this.emitHook(entity, `before${event}`, asRows);
    const rows = asRows.map((row) => clone(row));
    const result = await write(rows);
    await this.emitHook(entity, `after${event}`, rows);
    return result;
  }

  /** Fires the global listeners first, then the entity's own hooks. */
  private async emitHook<E extends object>(entity: Type<E>, event: HookEvent, payloads: readonly E[]): Promise<void> {
    if (!this.hasHook(entity, event)) return;

    for (const listener of this.extra?.listeners ?? []) {
      await listener[event]?.({ entity, querier: this, payloads, event });
    }

    await runHooks(entity, event, payloads, { querier: this, onCommit: (callback) => this.onCommit(callback) });
  }

  /**
   * Runs `task` after everything already queued, one at a time, once no transaction of another flow holds the
   * connection: a statement from outside one never lands in it. Not re-entrant: never nest `serialize` calls.
   */
  protected serialize<T>(task: () => Promise<T>): Promise<T> {
    if (this.#slot.held && !this.scopeHere()) {
      return this.#turn().then(() => this.serialize(task));
    }
    if (this.#stream) {
      return Promise.reject(new UqlUsageError(STREAM_HOLDS_QUERIER));
    }
    return this.enqueue(task);
  }

  /** Waits for a transaction another flow holds on the connection to end. */
  #turn(): Promise<void> {
    return awaitTurn(this.#slot, () => !!this.scopeHere());
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const res = this.taskQueue.then(task);
    this.taskQueue = res.catch(() => {});
    return res;
  }

  /** Runs `task`, logs `query` with its duration, and tags a failure with it: a method, since a decorator would lose the generics. */
  protected async timed<T>(query: string, values: readonly unknown[] | undefined, task: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    try {
      return await task();
    } catch (err) {
      throw enrichError(err, this.logger, query, values);
    } finally {
      this.logger.logQuery(query, values, Math.round(performance.now() - startTime));
    }
  }

  /**
   * `rows` as {@link timed} runs a statement: logged once they end, timed to the first row since the
   * time after it is the loop's, and a failure tagged with `query`.
   */
  protected async *timedStream<T>(
    query: string,
    values: readonly unknown[] | undefined,
    rows: AsyncIterable<T>,
  ): AsyncGenerator<T> {
    const startTime = performance.now();
    let answeredAt: number | undefined;
    try {
      for await (const row of rows) {
        answeredAt ??= performance.now();
        yield row;
      }
    } catch (err) {
      throw enrichError(err, this.logger, query, values);
    } finally {
      this.logger.logQuery(query, values, Math.round((answeredAt ?? performance.now()) - startTime));
    }
  }

  /** Opens a transaction that holds this querier until `commitTransaction` or `rollbackTransaction`, whatever flow calls them. */
  async beginTransaction(opts?: TransactionOptions): Promise<void> {
    if (this.scopeHere()) {
      throw new UqlUsageError('pending transaction');
    }
    await this.open(newScope(this, this.#slot), true, opts);
  }

  /** Strict: this is the check that catches a forgotten `beginTransaction`. */
  async commitTransaction(): Promise<void> {
    const held = this.#slot.held;
    if (!held?.manual || held.scope.querier !== this) {
      throw new UqlUsageError('not a pending transaction');
    }
    await this.close(true);
    await runCallbacks(held.scope.onCommit);
  }

  /**
   * Rolls back the transaction this querier holds, or does nothing when there is none: it is called from `catch`
   * and `finally`, where the caller cannot know whether `beginTransaction` got far enough to open one. A
   * transaction another flow's callback holds is waited for, and so has ended by then.
   */
  rollbackTransaction(): Promise<void> {
    return this.close(false);
  }

  /** Opens a transaction on the engine, once `open` has claimed the connection for it. */
  protected abstract openTransaction(opts?: TransactionOptions): Promise<void>;

  /** Commits the open transaction on the engine, or rolls it back when `commit` is false. */
  protected abstract endTransaction(commit: boolean): Promise<void>;

  /**
   * Closes a stream left open and rolls back an unfinished transaction, then hands the connection back,
   * discarding it where it is unusable: the pool would otherwise take one still reading, or in a state the
   * next borrower inherits. Never throws first, since `await using` has no other way to release.
   */
  async release(): Promise<void> {
    await this.#stream?.return(undefined).catch((err: unknown) => {
      this.logger.logError('closing an open stream failed; discarding the connection', err);
      this.#unusable = true;
    });
    await this.serialize(async () => {
      if (this.holds()) {
        this.logger.logWarn('rolling back a transaction left open at release');
        await this.end(false);
      }
    }).catch((err: unknown) => {
      this.logger.logError('rollback failed; discarding the connection', err);
    });
    this.released = true;
    return this.enqueue(() => this.internalRelease(this.#unusable));
  }

  async [Symbol.asyncDispose](): Promise<void> {
    return this.release();
  }

  /** `discard` means the connection must not be reused; backends with a pool evict it instead. */
  protected abstract internalRelease(discard: boolean): Promise<void>;
}
