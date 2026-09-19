import { assertSoleId, getMeta, idOf, namesKey, relationOf } from '../entity/index.js';

import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type {
  EntityData,
  EntityId,
  EntityWrite,
  EntityMeta,
  ExtraOptions,
  FieldKey,
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
  QueryOne,
  QueryOneProjected,
  QueryOptions,
  QueryPage,
  QueryPopulate,
  QueryProjected,
  QuerySearch,
  PrimaryKey,
  QueryUpdateResult,
  QueryUpsertOneResult,
  QueryUpsertManyResult,
  QueryWhere,
  RelationKey,
  RelationMeta,
  RelationQuery,
  TransactionOptions,
  Type,
  UpdatePayload,
  UpdateWrite,
  WrittenId,
} from '../type/index.js';
import {
  cascadesOnDelete,
  childrenOf,
  clone,
  entityName,
  fillOnFields,
  filterFieldKeys,
  filterPersistableRelationKeys,
  forEachRequestedRelation,
  getKeys,
  getRelationRequestSummary,
  idOnlyQuery,
  isPagedQuery,
  hasKeys,
  isScalarId,
  LoggerWrapper,
  parentJoins,
  queryLoggerFor,
  parseRelationAtKey,
  parseRelationQueryValue,
  rowKey,
  runHooks,
  someKey,
  targetKeyColumns,
  whereIds,
  withoutSoftDeleteFilter,
} from '../util/index.js';
import { enrichError, UqlOptimisticLockError } from './queryError.js';

/**
 * Refuses a nullish id, which would reduce to no filter at all, and a composite id missing a column,
 * which would address every row agreeing on the rest. Callers are `async`, so it always rejects.
 */
function assertIdValue<E>(entity: Type<E>, id: EntityId<E>): void {
  if (id === undefined || id === null) {
    throw new TypeError(`'${entity.name}' was addressed by id, but the id is ${String(id)}`);
  }
  if (isScalarId(id)) {
    // One value names one column, which `whereIds` refuses on a composite.
    return;
  }
  // Every key, or the `$where` names only some of the columns and addresses each row that agrees on
  // those - which for an update or a delete is silently far more than the one row asked for. `{}`
  // reaches here too, and would otherwise be an unfiltered statement over the whole table.
  const given = id as Record<string, unknown>;
  const { ids } = getMeta(entity);
  const missing = ids.filter((key) => given[key] == null);
  if (missing.length) {
    throw new TypeError(
      `'${entity.name}' is addressed by an object carrying every key of its primary key (${ids.join(', ')}); missing ${missing.join(', ')}.`,
    );
  }
}

/** The column a write matches a parent's sole key against, on the junction or the child. */
function soleParentColumn(relOpts: RelationMeta): string {
  return parentJoins(relOpts, 1)[0].joined;
}

/**
 * A bulk write names the rows it changes: a `$where`, or a `$limit` capping how many it reaches. The
 * caller's own clauses are what count - a filter the entity adds, soft delete's, would otherwise make
 * every table look narrowed, which is the case this exists to catch.
 */
function assertNamesRows<E>(entity: Type<E>, method: string, q: QuerySearch<E> | undefined, opts?: QueryOptions): void {
  if (opts?.unfiltered || hasKeys(q?.$where) || q?.$limit !== undefined) {
    return;
  }
  throw new TypeError(
    `'${method}' over '${entity.name}' names no rows, so it would address every one: pass '{ unfiltered: true }' to mean it`,
  );
}

/**
 * An optimistic lock as one update applies it: the value the payload carried, out of the payload and
 * into the filter, and the next one back in its place. The bump is a plain value rather than SQL
 * arithmetic, since the filter pins what the column holds, which spares every engine a read-back.
 */
function lockVersion<E extends object>(
  meta: EntityMeta<E>,
  key: FieldKey<E>,
  q: QuerySearch<E>,
  row: UpdatePayload<E>,
): { readonly expected: unknown; readonly q: QuerySearch<E> } {
  const expected = row[key];
  if (expected === undefined || expected === null) {
    throw new TypeError(
      `an update of '${entityName(meta)}' carries no '${key}': a versioned row is written against the version it was read at`,
    );
  }
  row[key] = (typeof expected === 'bigint' ? expected + 1n : Number(expected) + 1) as E[FieldKey<E>];
  return { expected, q: { ...q, $where: { $and: [q.$where ?? {}, { [key]: expected }] } as QueryWhere<E> } };
}

/**
 * Refuses a write that cannot carry the lock, rather than writing over whatever the row holds now.
 * An upsert has no portable way to match a version - MySQL's `ON DUPLICATE KEY UPDATE` takes no
 * `WHERE` - and a write the library itself composes has no version to carry.
 */
function assertUnversioned<E extends object>(meta: EntityMeta<E>, method: string): void {
  if (meta.version) {
    throw new TypeError(
      `cannot '${method}' the versioned '${entityName(meta)}': it carries no '${meta.version}' to match, so update it by id`,
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

/** A parent's id and the value it writes into one of its relations. */
type RelationWrite = { readonly id: unknown; readonly value: unknown };

/** Base class for all database queriers. */
export abstract class AbstractQuerier implements Querier {
  /**
   * Internal promise used to queue database operations.
   * This ensures that each operation is executed serially, preventing race conditions
   * and ensuring that the database connection is used safely across concurrent calls.
   */
  private taskQueue: Promise<unknown> = Promise.resolve();

  /**
   * A querier is one unit of work, so releasing ends it. Checked where each backend reaches for its
   * connection, on every driver and not just the pooled ones.
   */
  protected released = false;
  protected readonly logger: LoggerWrapper;
  abstract readonly dialect: AbstractDialect;

  constructor(readonly extra?: ExtraOptions) {
    this.logger = queryLoggerFor(extra);
  }

  protected validateProjectionQuery<E extends object>(entity: Type<E>, q: Query<E>): void {
    this.validateProjectionQueryRecursive(entity, q, entityName(getMeta(entity)));
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
          throw new TypeError(
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

  /** `[entity, query, opts]` from either call form, `(entity, q, opts)` or `({ $entity, ...q }, opts)`. */
  protected resolveEntityQuery<E extends object, Q extends object>(
    entityOrQuery: Type<E> | (Q & { $entity: Type<E> }),
    maybeQueryOrOpts?: Q | QueryOptions,
    maybeOpts?: QueryOptions,
  ): [Type<E>, Q, QueryOptions | undefined] {
    if (typeof entityOrQuery === 'function' && entityOrQuery.prototype) {
      return [entityOrQuery, (maybeQueryOrOpts as Q) ?? ({} as Q), maybeOpts];
    }
    const q = entityOrQuery as Q & { $entity: Type<E> };
    if (!q.$entity) {
      throw new TypeError('$entity is required when using query-object syntax');
    }
    const { $entity, ...query } = q;
    return [$entity, query as Q, maybeQueryOrOpts as QueryOptions | undefined];
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
  async findOne<E extends object>(
    entityOrQuery: Type<E> | (QueryOne<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: QueryOne<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<E | undefined> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, maybeQueryOrOpts, maybeOpts);
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
  async findMany<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: Query<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<E[]> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    this.validateProjectionQuery(entity, q);
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

  /** Stream records with the relations and counts `findMany` reads, the entity passed first or as `$entity`. No hooks fire. */
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
  findManyStream<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: Query<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): AsyncIterable<E> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    this.validateProjectionQuery(entity, q);
    return this.internalFindManyStream(entity, q, opts);
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
  async findManyAndCount<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: Query<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<[E[], number]> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    this.validateProjectionQuery(entity, q);
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

  /** Count records matching the query, the entity passed first or as the query's `$entity`. */
  count<E extends object>(entity: Type<E>, q?: QueryPage<E>, opts?: QueryOptions): Promise<number>;
  count<E extends object>(q: QueryPage<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  async count<E extends object>(
    entityOrQuery: Type<E> | (QueryPage<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: QueryPage<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<number> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    return this.internalCount(entity, q, opts);
  }

  /** How many rows match, or how many of them a page takes: counted where they are, never read. */
  protected abstract internalCount<E extends object>(
    entity: Type<E>,
    q: QueryPage<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  /** Whether anything matches, the entity passed first or as `$entity`: a count capped at one row. */
  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: QueryOptions): Promise<boolean>;
  exists<E extends object>(q: QueryFilter<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<boolean>;
  async exists<E extends object>(
    entityOrQuery: Type<E> | (QueryFilter<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: QueryFilter<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<boolean> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, maybeQueryOrOpts, maybeOpts);
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

  async insertOne<E extends object>(entity: Type<E>, payload: EntityWrite<E>): Promise<WrittenId<E> | undefined> {
    const [id] = await this.insertMany(entity, [payload]);
    return id;
  }

  /**
   * The `onInsert` values are filled here, before the write, so the after hooks and the ids read the
   * same rows the statement wrote.
   */
  async insertMany<E extends object>(
    entity: Type<E>,
    payload: EntityWrite<E>[],
  ): Promise<(WrittenId<E> | undefined)[]> {
    if (!payload?.length) {
      return [];
    }
    const meta = getMeta(entity);
    return this.hooked(entity, 'Insert', payload, async (rows) => {
      fillOnFields(meta, rows, 'onInsert');
      await this.internalInsertMany(entity, rows);
      return writtenIds(meta, rows);
    });
  }

  /** Writes `rows`, and onto each one the key the database generated for it, where it can tell. */
  protected abstract internalInsertMany<E extends object>(entity: Type<E>, rows: EntityData<E>[]): Promise<void>;

  async updateOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions,
  ) {
    assertIdValue(entity, id);
    return this.updateMany(entity, { $where: whereIds(getMeta(entity), id) }, payload, opts);
  }

  /** Settles the rows first where the update cascades, so a payload changing what `$where` reads still names them. */
  async updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdateWrite<E>,
    opts?: QueryOptions,
  ): Promise<number> {
    assertNamesRows(entity, 'updateMany', q, opts);
    const meta = getMeta(entity);
    return this.hooked(entity, 'Update', [payload], async ([row]) => {
      fillOnFields(meta, [row], 'onUpdate');
      const { version } = meta;
      const lock = version && lockVersion(meta, version, q, row);
      const relKeys = filterPersistableRelationKeys(meta, row, 'persist');
      if (!relKeys.length && !this.settlesWrite(entity, q)) {
        const changes = await this.updateColumns(entity, lock ? lock.q : q, row, opts, 0);
        return lock && !changes ? this.throwStaleVersion(entity, version, q, lock.expected, opts) : changes;
      }
      if (lock) {
        // Everything below reads the ids first and writes them in a second statement, which puts the
        // race back in the gap between the two - the very thing the version is here to close.
        // `settlesWrite` covers the paged forms, so `$sort`, `$limit` and `$skip` land here as well.
        throw new TypeError(
          `cannot update '${entityName(meta)}' this way: a versioned row is matched and written in one statement, so it takes no '$sort', '$limit' or '$skip', writes no relation, and filters by none`,
        );
      }
      const ids = await this.settleIds(entity, q, opts);
      if (!ids.length) {
        return 0;
      }
      const changes = await this.updateColumns(entity, { $where: whereIds(meta, ids) }, row, opts, ids.length);
      for (const relKey of relKeys) {
        await this.saveRelation(
          entity,
          relKey,
          ids.map((id) => ({ id, value: row[relKey] })),
          true,
        );
      }
      return changes;
    });
  }

  /**
   * Why an update matched no row: another writer moved the version on, or the row is gone. One read
   * without the version predicate answers it, and it runs only on the failure, so the happy path
   * still costs one statement. Best effort by nature - the row can change again while we ask.
   */
  private async throwStaleVersion<E extends object>(
    entity: Type<E>,
    key: FieldKey<E>,
    q: QuerySearch<E>,
    expected: unknown,
    opts?: QueryOptions,
  ): Promise<never> {
    const meta = getMeta(entity);
    const row = await this.findOne(entity, { $select: { [key]: true }, $where: q.$where } as Query<E>, opts);
    const actual = row?.[key];
    throw new UqlOptimisticLockError(
      actual === undefined
        ? `no row of '${entityName(meta)}' matched the update: it is gone, or the filter names none`
        : `'${entityName(meta)}' moved on: the payload carries '${key}' ${String(expected)}, the row is at ${String(actual)}`,
      expected,
      actual,
    );
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
      throw new TypeError(`'${entity.name}' has not enabled 'softDelete'`);
    }
    assertUnversioned(meta, 'restoreMany');
    const $where = { ...q.$where, [meta.softDelete]: { $ne: null } } as QueryWhere<E>;
    return this.updateMany(entity, { ...q, $where }, { [meta.softDelete]: null } as UpdateWrite<E>, {
      filters: { softDelete: false },
    });
  }

  /** Fires `beforeUpsert`/`afterUpsert`: which branch a row takes is the database's to decide, so neither the insert's nor the update's pair fits. */
  async upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityWrite<E>,
  ): Promise<QueryUpsertOneResult<E>> {
    const meta = getMeta(entity);
    assertUnversioned(meta, 'upsertOne');
    return this.hooked(entity, 'Upsert', [payload], async (rows) => {
      const { ids, changes, created } = await this.internalUpsertOne(entity, conflictPaths, rows[0]);
      adoptReportedIds(meta, rows, ids);
      const [id] = writtenIds(meta, rows);
      return { id, changes, created };
    });
  }

  async upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityWrite<E>[],
  ): Promise<QueryUpsertManyResult<E>> {
    const meta = getMeta(entity);
    assertUnversioned(meta, 'upsertMany');
    return this.hooked(entity, 'Upsert', payload, async (rows) => {
      const { ids, changes } = await this.internalUpsertMany(entity, conflictPaths, rows);
      adoptReportedIds(meta, rows, ids);
      return { ids: writtenIds(meta, rows), changes };
    });
  }

  protected abstract internalUpsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>,
  ): Promise<QueryUpdateResult>;

  protected abstract internalUpsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ): Promise<QueryUpdateResult>;

  async deleteOneById<E extends object>(entity: Type<E>, id: EntityId<E>, opts?: QueryOptions) {
    assertIdValue(entity, id);
    return this.deleteMany(entity, { $where: whereIds(getMeta(entity), id) }, opts);
  }

  /** Delete records matching the query, the entity passed first or as `$entity`; soft-deletes unless `opts.hardDelete`. */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  async deleteMany<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    qOrOpts?: QuerySearch<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<number> {
    const [entity, q, opts] = this.resolveEntityQuery(entityOrQuery, qOrOpts, maybeOpts);
    assertNamesRows(entity, 'deleteMany', q, opts);
    const meta = getMeta(entity);
    const cascades = cascadesOnDelete(meta);
    const watched = this.hasHook(entity, 'beforeDelete') || this.hasHook(entity, 'afterDelete');
    if (!watched && !cascades && !this.settlesWrite(entity, q)) {
      return this.internalDeleteMany(entity, q, opts);
    }
    // A hard delete takes already-soft-deleted rows too, so reading them back has to see them.
    const readOpts = opts?.hardDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts;
    // A hook receives the rows themselves; the ids read off them name the same rows a second read might not.
    const doomed = watched ? await this.internalFindMany(entity, q, readOpts) : [];
    const ids = watched ? doomed.map((row) => idOf(meta, row)) : await this.settleIds(entity, q, readOpts);
    if (!ids.length) {
      return 0;
    }
    await this.emitHook(entity, 'beforeDelete', doomed);
    // Children first: they hold the foreign key, which a schema without `ON DELETE CASCADE` enforces.
    if (cascades) {
      await this.deleteRelations(entity, ids, opts);
    }
    const changes = await this.internalDeleteMany(entity, { $where: whereIds(meta, ids) }, opts);
    await this.emitHook(entity, 'afterDelete', doomed);
    return changes;
  }

  /** Runs one DELETE (or soft-delete stamp) over `q`, which names its rows by id wherever {@link deleteMany} settled them. */
  protected abstract internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  async saveOne<E extends object>(entity: Type<E>, payload: EntityWrite<E>): Promise<WrittenId<E> | undefined> {
    // Named here as well as in `saveMany`, so the refusal names the method the caller reached for.
    assertUnversioned(getMeta(entity), 'saveOne');
    const [id] = await this.saveMany(entity, [payload]);
    return id;
  }

  /**
   * Whether a row names its key decides its statement, never whether the row exists: a named row
   * upserts on that key, so a stale id is written rather than silently missed, and an unnamed one
   * inserts. A composite is always named. The hooks follow the statement: a named row fires the upsert pair.
   */
  async saveMany<E extends object>(entity: Type<E>, payload: EntityWrite<E>[]): Promise<(WrittenId<E> | undefined)[]> {
    const meta = getMeta(entity);
    assertUnversioned(meta, 'saveMany');
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
        const inserted = await this.insertMany(
          entity,
          toInsert.map((index) => payload[index]),
        );
        for (let position = 0; position < toInsert.length; position++) {
          ids[toInsert[position]] = inserted[position];
        }
      }
      if (toUpsert.length) {
        const conflictPaths = Object.fromEntries(meta.ids.map((key) => [key, true])) as QueryConflictPaths<E>;
        const { ids: upserted } = await this.upsertMany(
          entity,
          conflictPaths,
          toUpsert.map((index) => payload[index]),
        );
        for (let position = 0; position < toUpsert.length; position++) {
          ids[toUpsert[position]] = upserted[position];
        }
      }
    };

    // Only a batch carrying both kinds is more than one statement; `transaction` is re-entrant, so
    // this is free inside a caller's own.
    await (toInsert.length && toUpsert.length ? this.transaction(write) : write());

    return ids;
  }

  /** Writes each inserted row's relations, one set of statements per relation whatever the number of rows. */
  protected async insertRelations<E extends object>(entity: Type<E>, rows: E[]) {
    const meta = getMeta(entity);
    const [idKey] = meta.ids;
    for (const relKey of filterPersistableRelationKeys(meta, meta.relations, 'persist')) {
      const writes = rows.flatMap((row) => (row[relKey] == null ? [] : [{ id: row[idKey], value: row[relKey] }]));
      if (writes.length) {
        await this.saveRelation(entity, relKey, writes, false);
      }
    }
  }

  /** `EntityId` because a settled composite row is an object, which {@link childrenOf} reads each foreign key column out of. */
  private async deleteRelations<E extends object>(entity: Type<E>, ids: EntityId<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, meta.relations, 'delete');
    // Cascade forwards `opts` (including `hardDelete`); each child soft-deletes only if it can.
    for (const relKey of relKeys) {
      const relOpts = relationOf(meta, relKey);
      const relEntity = relOpts.entity();
      const target = relOpts.through ? relOpts.through() : relEntity;
      await this.deleteMany(target, { $where: childrenOf(parentJoins(relOpts, meta.ids.length), ids) }, opts);
    }
  }

  /**
   * Writes each parent's value into one relation. The parent owns what it points at: an update replaces
   * it, and a `null` only clears it.
   */
  private async saveRelation<E extends object>(
    entity: Type<E>,
    relKey: RelationKey<E>,
    writes: readonly RelationWrite[],
    isUpdate: boolean,
  ) {
    const meta = getMeta(entity);
    // Writing the parent's key into a child is one column per key, and the helpers below read the first pair.
    assertSoleId(meta, 'saving a relation');
    const relOpts = relationOf(meta, relKey);
    const relEntity = relOpts.entity();
    if (relOpts.cardinality === 'm1') {
      return this.saveManyToOne(entity, relEntity, relOpts.references[0].local, writes);
    }
    const holder = relOpts.through ? relOpts.through() : relEntity;
    const parentColumn = soleParentColumn(relOpts);
    if (isUpdate) {
      const ids = writes.map(({ id }) => id);
      await this.deleteMany(holder, { $where: { [parentColumn]: ids } });
    }
    // Each parent gets its own copies, so a row listed for two parents is written twice.
    const children = writes.flatMap(({ id, value }) => [value ?? []].flat().map((row: object) => ({ id, row })));
    if (!children.length) {
      return;
    }
    if (!relOpts.through) {
      await this.saveMany(
        relEntity,
        children.map(({ id, row }) => ({ ...row, [parentColumn]: id })),
      );
      return;
    }
    const savedIds = await this.saveMany(
      relEntity,
      children.map(({ row }) => row),
    );
    // A link needs the target's id, which a MySQL batch mixing supplied and generated keys cannot report.
    if (savedIds.includes(undefined)) {
      throw new TypeError(
        `'${relEntity.name}' rows saved through '${holder.name}' reported no id, so they cannot be linked. ` +
          'Insert them with their own ids, or save the relation in its own statement.',
      );
    }
    const [targetColumn] = targetKeyColumns(relOpts, 1);
    await this.insertMany(
      holder,
      children.map(({ id }, index) => ({ [parentColumn]: id, [targetColumn]: savedIds[index] })),
    );
  }

  /** Each parent gets its own referenced row, and its own column pointing at it. */
  private async saveManyToOne<E extends object>(
    entity: Type<E>,
    relEntity: Type<object>,
    localColumn: string,
    writes: readonly RelationWrite[],
  ) {
    // Before anything is written: the follow-up that points each row at its new relation carries no
    // version, and half an insert is worse than a refusal.
    assertUnversioned(getMeta(entity), 'save a to-one relation of');
    const pointing = writes.filter(({ value }) => value);
    const referenceIds = await this.insertMany(
      relEntity,
      pointing.map(({ value }) => value as object),
    );
    for (const [index, { id }] of pointing.entries()) {
      await this.updateOneById(entity, id as EntityId<E>, { [localColumn]: referenceIds[index] } as UpdateWrite<E>);
    }
  }

  abstract readonly hasOpenTransaction: boolean;

  /**
   * Runs `callback` in a transaction, joining one already open. A rollback that fails is logged, never
   * thrown over the original error, and the connection stays with whoever acquired it.
   */
  async transaction<T>(callback: () => Promise<T>, opts?: TransactionOptions) {
    if (this.hasOpenTransaction) {
      return callback();
    }
    try {
      await this.beginTransaction(opts);
      const res = await callback();
      await this.commitTransaction();
      return res;
    } catch (err) {
      // Reported rather than thrown: the error being unwound is the useful one. Inline rather than
      // shared with `release` below, because this method is grafted onto plain objects in tests and
      // every `this.x` it reaches for has to exist there too.
      await this.rollbackTransaction().catch((rollbackErr: unknown) => {
        this.logger.logError('rollback failed', rollbackErr);
      });
      throw err;
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
   * The ids of `rows`, read back by the columns an upsert matched them on, for a statement that could
   * not report them in payload order. A row that no read row matches, or that two do, keeps
   * `undefined`: a missing id is honest where a guessed one is not.
   */
  protected async idsByConflict<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    rows: EntityData<E>[],
  ): Promise<(PrimaryKey | undefined)[]> {
    const meta = getMeta(entity);
    const [idKey] = meta.ids;
    const keys = getKeys(conflictPaths);
    const q = {
      $select: Object.fromEntries([idKey, ...keys].map((key) => [key, true])),
      $where: { $or: rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]]))) },
    } as Query<E>;
    const found = await this.internalFindMany(entity, q, { filters: withoutSoftDeleteFilter(undefined) });
    const byConflict = new Map<string, PrimaryKey | undefined>();
    for (const row of found) {
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
    payloads: readonly (EntityWrite<E> | UpdateWrite<E>)[],
    write: (rows: E[]) => Promise<T>,
  ): Promise<T> {
    // The one place a caller's write becomes the row the rest of the library handles. They are the
    // same object: a write is the entity's data without the keys the database fills, which
    // TypeScript cannot relate across an entity it has not resolved.
    const asRows = payloads as E[];
    await this.emitHook(entity, `before${event}`, asRows);
    const rows = clone(asRows);
    const result = await write(rows);
    await this.emitHook(entity, `after${event}`, rows);
    return result;
  }

  /** Fires the global listeners first, then the entity's own hooks. */
  private async emitHook<E extends object>(entity: Type<E>, event: HookEvent, payloads: E[]): Promise<void> {
    if (!this.hasHook(entity, event)) return;

    for (const listener of this.extra?.listeners ?? []) {
      const fn = listener[event];
      if (fn) {
        const result = fn({ entity, querier: this, payloads, event });
        if (result instanceof Promise) await result;
      }
    }

    await runHooks(entity, event, payloads, { querier: this });
  }

  /** Runs `task` after everything already queued, one at a time. Not re-entrant: never nest `serialize` calls. */
  protected serialize<T>(task: () => Promise<T>): Promise<T> {
    const res = this.taskQueue.then(task);
    this.taskQueue = res.catch(() => {});
    return res;
  }

  /** Runs `task`, logs `query` with its duration, and tags a failure with it: a method, since a decorator would lose the generics. */
  protected async timed<T>(query: string, values: unknown[] | undefined, task: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    try {
      return await task();
    } catch (err) {
      throw enrichError(err, this.logger, query, values);
    } finally {
      this.logger.logQuery(query, values, Math.round(performance.now() - startTime));
    }
  }

  abstract beginTransaction(opts?: TransactionOptions): Promise<void>;

  /** Strict: this is the check that catches a forgotten `beginTransaction`. */
  abstract commitTransaction(): Promise<void>;

  /**
   * Rolls the open transaction back, or does nothing when there is none: it is called from `catch` and
   * `finally`, where the caller cannot know whether `beginTransaction` got far enough to open one.
   */
  abstract rollbackTransaction(): Promise<void>;

  /**
   * Rolls back an unfinished transaction, then hands the connection back, discarding it if the rollback
   * failed. Never throws first, since `await using` has no other way to release.
   */
  async release(): Promise<void> {
    let discard = false;
    if (this.hasOpenTransaction) {
      this.logger.logWarn('rolling back a transaction left open at release');
      // The rollback doubles as a health check. One that succeeds proves the connection round-trips and
      // left no transaction behind, so it is safe to reuse. One that fails leaves a session state
      // nothing here can name, and the next borrower would inherit it.
      await this.rollbackTransaction().catch((err: unknown) => {
        this.logger.logError('rollback failed; discarding the connection', err);
        discard = true;
      });
    }
    this.released = true;
    return this.serialize(() => this.internalRelease(discard));
  }

  async [Symbol.asyncDispose](): Promise<void> {
    return this.release();
  }

  /** `discard` means the connection must not be reused; backends with a pool evict it instead. */
  protected abstract internalRelease(discard: boolean): Promise<void>;
}
