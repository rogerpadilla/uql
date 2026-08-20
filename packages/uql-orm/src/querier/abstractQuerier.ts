import { getMeta } from '../entity/index.js';

import type {
  EntityMeta,
  ExtraOptions,
  HookEvent,
  IdKey,
  IdValue,
  LoggingOptions,
  Querier,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryGroupMap,
  QueryOne,
  QueryOptions,
  QueryPopulate,
  QuerySearch,
  QueryUpdateResult,
  QueryWhere,
  RawRow,
  RelationKey,
  RelationMeta,
  RelationValue,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import {
  asSelectMap,
  augmentWhere,
  clone,
  filterPersistableRelationKeys,
  forEachRequestedRelation,
  getKeys,
  getRelationRequestSummary,
  LoggerWrapper,
  parseRelationAtKey,
  parseRelationQueryValue,
  type RelationQuery,
  runHooks,
} from '../util/index.js';
import { enrichError } from './queryError.js';

/**
 * Base class for all database queriers.
 * It provides a standardized way to execute tasks serially to prevent race conditions on database connections.
 */
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

  constructor(readonly extra?: ExtraOptions) {
    this.logger = new LoggerWrapper(extra?.logger as LoggingOptions, {
      logValues: extra?.logValues,
      slowQuery: extra?.slowQuery,
    });
  }

  protected validateProjectionQuery<E extends object>(entity: Type<E>, q: Query<E>): void {
    this.validateProjectionQueryRecursive(entity, q, getMeta(entity).name ?? entity.name);
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
      const relOpts = meta.relations[relKey];
      if (!relOpts) return;
      type Related = InstanceType<ReturnType<typeof relOpts.entity>>;
      const relEntity = relOpts.entity();
      const parsed = parseRelationQueryValue<Related>(relValue);
      if (parsed.nested) {
        this.validateProjectionQueryRecursive(relEntity, parsed.query, `${path}.${relKey}`);
      }
    });
  }

  /**
   * Resolves `[entity, query, opts]` for the dual call pattern: `(entity, q, opts)` (entity argument)
   * vs `(query, opts)` (entity via the query's `$entity` field).
   */
  protected resolveEntityQuery<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: QuerySearch<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): [Type<E>, QuerySearch<E>, QueryOptions | undefined] {
    if (typeof entityOrQuery === 'function' && entityOrQuery.prototype) {
      return [entityOrQuery as Type<E>, (maybeQueryOrOpts as QuerySearch<E>) ?? {}, maybeOpts];
    }
    const q = entityOrQuery as QuerySearch<E> & { $entity: Type<E> };
    if (!q.$entity) {
      throw new TypeError('$entity is required when using query-object syntax');
    }
    const { $entity, ...query } = q;
    return [$entity, query as QuerySearch<E>, maybeQueryOrOpts as QueryOptions | undefined];
  }

  findOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: QueryOptions,
  ): Promise<E | undefined>;
  async findOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    q: QueryOne<E> = {},
    opts?: QueryOptions,
  ): Promise<E | undefined> {
    return this.findOne(entity, { ...q, $where: augmentWhere(getMeta(entity), q.$where, id) }, opts);
  }

  /**
   * Find a single record matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  async findOne<E extends object>(entity: Type<E>, q: QueryOne<E>, opts?: QueryOptions): Promise<E | undefined>;
  async findOne<E extends object>(q: QueryOne<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<E | undefined>;
  async findOne<E extends object>(
    entityOrQuery: Type<E> | (QueryOne<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: QueryOne<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<E | undefined> {
    const [entity, q, opts] = this.resolveEntityQuery<E>(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    const rows = await this.findMany(entity, { ...q, $limit: 1 }, opts);
    return rows[0];
  }

  /**
   * Find multiple records matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  findMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<E[]>;
  findMany<E extends object>(q: Query<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<E[]>;
  async findMany<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: Query<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<E[]> {
    const [entity, q, opts] = this.resolveEntityQuery<E>(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    this.validateProjectionQuery(entity, q);
    const founds = await this.internalFindMany(entity, q, opts);
    await this.emitHook(entity, 'afterLoad', founds);
    return founds;
  }

  protected abstract internalFindMany<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): Promise<E[]>;

  /**
   * Stream records as an async iterable.
   * Supports both entity-as-argument and entity-as-field patterns.
   *
   * **SQL:** Joinable relations (e.g. m1 / one-to-one) are still emitted in the streamed SQL; **to-many**
   * relations are not filled (no second query) - requesting them throws a clear `TypeError`.
   *
   * **MongoDB:** Relation loading uses aggregation + follow-up queries in `findMany`; **streams use a plain
   * find cursor**, so any requested relation keys in `$select` / `$populate` throw a `TypeError`.
   *
   * No `afterLoad` hooks on streamed rows.
   */
  findManyStream<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): AsyncIterable<E>;
  findManyStream<E extends object>(q: Query<E> & { $entity: Type<E> }, opts?: QueryOptions): AsyncIterable<E>;
  findManyStream<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: Query<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): AsyncIterable<E> {
    const [entity, q, opts] = this.resolveEntityQuery<E>(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    this.validateProjectionQuery(entity, q);
    return this.internalFindManyStream(entity, q, opts);
  }

  protected abstract internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): AsyncIterable<E>;

  /**
   * Find multiple records and return both the records and total count.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<[E[], number]>;
  findManyAndCount<E extends object>(q: Query<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<[E[], number]>;
  async findManyAndCount<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: Query<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<[E[], number]> {
    const [entity, q, opts] = this.resolveEntityQuery<E>(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    this.validateProjectionQuery(entity, q);
    const { $sort: _, $limit: _l, $skip: _s, ...qCount } = q;
    const [founds, count] = await Promise.all([
      this.internalFindMany(entity, q, opts),
      this.internalCount(entity, qCount, opts),
    ]);
    await this.emitHook(entity, 'afterLoad', founds);
    return [founds, count];
  }

  /**
   * Count records matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  count<E extends object>(entity: Type<E>, q?: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  count<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  count<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    maybeQueryOrOpts?: QuerySearch<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<number> {
    const [entity, q, opts] = this.resolveEntityQuery<E>(entityOrQuery, maybeQueryOrOpts, maybeOpts);
    return this.internalCount(entity, q, opts);
  }

  protected abstract internalCount<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ): Promise<number>;

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

  async insertOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E> | undefined> {
    const [id] = await this.insertMany(entity, [payload]);
    return id;
  }

  async insertMany<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]> {
    await this.emitHook(entity, 'beforeInsert', payload);
    const ids = await this.internalInsertMany(entity, payload);
    await this.emitHook(entity, 'afterInsert', payload);
    return ids;
  }

  protected abstract internalInsertMany<E extends object>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E extends object>(entity: Type<E>, id: IdValue<E>, payload: UpdatePayload<E>, opts?: QueryOptions) {
    return this.updateMany(entity, { $where: id }, payload, opts);
  }

  async updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number> {
    await this.emitHook(entity, 'beforeUpdate', [payload as E]);
    const changes = await this.internalUpdateMany(entity, q, payload, opts);
    await this.emitHook(entity, 'afterUpdate', [payload as E]);
    return changes;
  }

  protected abstract internalUpdateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  restoreOneById<E extends object>(entity: Type<E>, id: IdValue<E>): Promise<number> {
    return this.restoreMany(entity, { $where: id });
  }

  async restoreMany<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number> {
    const meta = getMeta(entity);
    if (!meta.softDelete) {
      throw new TypeError(`'${entity.name}' has not enabled 'softDelete'`);
    }
    const $where = augmentWhere(meta, q.$where, { [meta.softDelete]: { $ne: null } } as QuerySearch<E>['$where']);
    return this.updateMany(entity, { ...q, $where }, { [meta.softDelete]: null } as UpdatePayload<E>, {
      filters: { softDelete: false },
    });
  }

  abstract upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E,
  ): Promise<QueryUpdateResult>;

  abstract upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
  ): Promise<QueryUpdateResult>;

  deleteOneById<E extends object>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions) {
    return this.deleteMany(entity, { $where: id }, opts);
  }

  /**
   * Delete records matching the query. Soft-deletes when the entity has a soft-delete field (unless
   * `opts.hardDelete`), otherwise removes the rows. Supports both entity-as-argument and entity-as-field patterns.
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  async deleteMany<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    qOrOpts?: QuerySearch<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<number> {
    const [entity, q, opts] = this.resolveEntityQuery<E>(entityOrQuery, qOrOpts, maybeOpts);

    await this.emitHook(entity, 'beforeDelete', []);
    const changes = await this.internalDeleteMany(entity, q, opts);
    await this.emitHook(entity, 'afterDelete', []);
    return changes;
  }

  protected abstract internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ): Promise<number>;

  async saveOne<E extends object>(entity: Type<E>, payload: E): Promise<IdValue<E>> {
    const [id] = await this.saveMany(entity, [payload]);
    return id;
  }

  async saveMany<E extends object>(entity: Type<E>, payload: E[]) {
    const meta = getMeta(entity);
    const toInsert: E[] = [];
    const toUpdate: E[] = [];
    const existingIds: IdValue<E>[] = [];

    const idKey = (meta.id ?? 'id') as IdKey<E>;

    for (const it of payload) {
      const id = it[idKey];
      if (!id) {
        toInsert.push(it);
      } else if (Object.keys(it).length === 1) {
        existingIds.push(id);
      } else {
        toUpdate.push(it);
      }
    }

    const [insertedIds, updatedIds] = await Promise.all([
      toInsert.length ? this.insertMany(entity, toInsert) : ([] as IdValue<E>[]),
      Promise.all(
        toUpdate.map(async (it) => {
          const id = it[idKey];
          const data = { ...it };
          delete data[idKey];
          await this.updateOneById(entity, id, data as E);
          return id;
        }),
      ),
    ]);

    return [...existingIds, ...insertedIds, ...updatedIds];
  }

  protected async fillToManyRelations<E>(entity: Type<E>, payload: E[], populate?: QueryPopulate<E>) {
    if (!payload.length) {
      return;
    }

    const meta = getMeta(entity);
    const relKeys = getRelationRequestSummary(meta, populate).toManyKeys;

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relEntity = relOpts.entity();
      type RelEntity = typeof relEntity;
      const relationQuery = clone(parseRelationAtKey(relKey, populate).query) as RelationQuery<RelEntity>;

      if (relOpts.through) {
        await this.fillToManyThroughRelation(payload, meta, relKey, relOpts, relationQuery as RelationQuery);
      } else if (relOpts.cardinality === '1m') {
        await this.fillToManyOneToMany(payload, meta, relKey, relOpts, relationQuery as RelationQuery, relEntity);
      }
    }
  }

  private async fillToManyThroughRelation<E>(
    payload: E[],
    meta: EntityMeta<E>,
    relKey: RelationKey<E>,
    relOpts: RelationMeta,
    relationQuery: RelationQuery,
  ): Promise<void> {
    const localField = relOpts.references[0].local;
    const throughEntity = relOpts.through!();
    const throughMeta = getMeta(throughEntity);
    const targetRelKey = getKeys(throughMeta.relations).find((key) =>
      throughMeta.relations[key]?.references.some(({ local }) => local === relOpts.references[1].local),
    );
    const ids = payload.map((it) => it[meta.id]);
    // A relation query names the target's columns, not the join table's, so the projection and the
    // filter belong on the populate below - resolved there against the entity that has them. Spread
    // onto the through query they asked `ItemTag` for `Tag`'s columns: `$where`/`$sort` failed with
    // "no such column", and `$exclude` collided with the `$select` this builds.
    const { $select: _select, $exclude: _exclude, $where: _where, ...throughQuery } = relationQuery;
    const throughFounds = await this.findMany(throughEntity, {
      ...throughQuery,
      $select: {
        [localField]: true,
      },
      $populate: {
        [targetRelKey!]: {
          ...relationQuery,
          $required: true,
        },
      },
      $where: {
        [localField]: ids,
      },
    });
    const founds = (throughFounds as unknown as RawRow[]).map((it) => ({
      ...(it[targetRelKey!] as RawRow),
      [localField]: it[localField],
    }));
    this.putChildrenInParents(payload, founds, meta.id, localField, relKey);
  }

  private async fillToManyOneToMany<E>(
    payload: E[],
    meta: EntityMeta<E>,
    relKey: RelationKey<E>,
    relOpts: RelationMeta,
    relationQuery: RelationQuery,
    relEntity: Type<object>,
  ): Promise<void> {
    const foreignField = relOpts.references[0].foreign;
    // The FK is what putChildrenInParents groups on, so it outlives the relation's projection
    // either way: added to a whitelisting `$select` (the raw-array form has nothing to augment),
    // dropped from a subtractive `$exclude`. `relationQuery` is already a clone.
    const select = asSelectMap(relationQuery.$select) as Record<string, unknown> | undefined;
    if (select && !select[foreignField]) {
      select[foreignField] = true;
    }
    delete (relationQuery.$exclude as Record<string, unknown> | undefined)?.[foreignField];
    const ids = payload.map((it) => it[meta.id]);
    relationQuery.$where = { ...relationQuery.$where, [foreignField]: ids };
    const founds = await this.findMany(relEntity, relationQuery);
    this.putChildrenInParents(payload, founds as RawRow[], meta.id, foreignField, relKey);
  }

  protected putChildrenInParents<E>(
    parents: E[],
    children: RawRow[],
    parentIdKey: keyof E & string,
    referenceKey: string,
    relKey: keyof E & string,
  ): void {
    const childrenByParentId: Record<string, RawRow[]> = {};
    for (const child of children) {
      const parentId = String(child[referenceKey]);
      if (!childrenByParentId[parentId]) childrenByParentId[parentId] = [];
      childrenByParentId[parentId].push(child);
    }
    for (const parent of parents) {
      parent[relKey] = childrenByParentId[String(parent[parentIdKey])] as E[keyof E & string];
    }
  }

  protected async insertRelations<E extends object>(entity: Type<E>, payload: E[]) {
    const meta = getMeta(entity);
    const entries = payload.reduce<{ it: E; relKeys: RelationKey<E>[] }[]>((acc, it) => {
      const relKeys = filterPersistableRelationKeys(meta, it, 'persist');
      if (relKeys.length > 0) acc.push({ it, relKeys });
      return acc;
    }, []);
    if (!entries.length) return;
    await Promise.all(
      entries.map(({ it, relKeys }) => Promise.all(relKeys.map((relKey) => this.saveRelation(entity, it, relKey)))),
    );
  }

  protected async updateRelations<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, payload, 'persist');

    if (!relKeys.length) {
      return;
    }

    const founds = await this.findMany(entity, { ...q, $select: { [meta.id]: true } } as Query<E>, opts);
    const ids = founds.map((found) => found[meta.id]);

    await Promise.all(
      ids.map((id) =>
        Promise.all(
          relKeys.map((relKey) => this.saveRelation(entity, { ...payload, [meta.id]: id } as E, relKey, true)),
        ),
      ),
    );
  }

  protected async deleteRelations<E extends object>(entity: Type<E>, ids: IdValue<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, meta.relations, 'delete');
    // Cascade forwards `opts` (including `hardDelete`); each child soft-deletes only if it can.
    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relEntity = relOpts.entity();
      const localField = relOpts.references[0].local;
      if (relOpts.through) {
        const throughEntity = relOpts.through();
        await this.deleteMany(throughEntity, { $where: { [localField]: ids } }, opts);
      } else {
        const foreignField = relOpts.references[0].foreign;
        await this.deleteMany(relEntity, { $where: { [foreignField]: ids } }, opts);
      }
    }
  }

  protected async saveRelation<E extends object>(
    entity: Type<E>,
    payload: E,
    relKey: RelationKey<E>,
    isUpdate?: boolean,
  ) {
    const meta = getMeta(entity);
    const id = payload[meta.id] as IdValue<E>;
    const relOpts = meta.relations[relKey];
    if (!relOpts) return;
    const relEntity = relOpts.entity();
    const relPayload = payload[relKey] as unknown as RelationValue<E>[];

    switch (relOpts.cardinality) {
      case '1m':
      case 'mm':
        return this.saveToMany(relOpts, relEntity, id, relPayload as unknown as object[], isUpdate);
      case '11':
        return this.saveOneToOne(relEntity, relOpts, id, relPayload as unknown as object);
      case 'm1':
        if (relPayload) return this.saveManyToOne(entity, relEntity, relOpts, id, relPayload as unknown as object);
    }
  }

  private async saveToMany(
    relOpts: RelationMeta,
    relEntity: Type<object>,
    id: unknown,
    relPayload: object[],
    isUpdate?: boolean,
  ) {
    const { references, through } = relOpts;
    if (through) {
      const localField = references[0].local;
      const throughEntity = through();
      if (isUpdate) {
        await this.deleteMany(throughEntity, { $where: { [localField]: id } as QueryWhere<object> });
      }
      if (relPayload) {
        const savedIds = await this.saveMany(relEntity, relPayload);
        const throughBodies = savedIds.map((relId) => ({
          [references[0].local]: id,
          [references[1].local]: relId,
        }));
        await this.insertMany(throughEntity, throughBodies);
      }
      return;
    }
    const foreignField = references[0].foreign;
    if (isUpdate) {
      await this.deleteMany(relEntity, { $where: { [foreignField]: id } as QueryWhere<object> });
    }
    if (relPayload) {
      for (const it of relPayload) {
        (it as RawRow)[foreignField] = id;
      }
      await this.saveMany(relEntity, relPayload);
    }
  }

  private async saveOneToOne(relEntity: Type<object>, relOpts: RelationMeta, id: unknown, relPayload: object) {
    const foreignField = relOpts.references[0].foreign;
    if (relPayload === null) {
      await this.deleteMany(relEntity, { $where: { [foreignField]: id } as QueryWhere<object> });
      return;
    }
    await this.saveOne(relEntity, { ...relPayload, [foreignField]: id });
  }

  private async saveManyToOne<E extends object>(
    entity: Type<E>,
    relEntity: Type<object>,
    relOpts: RelationMeta,
    id: IdValue<E>,
    relPayload: object,
  ) {
    const localField = relOpts.references[0].local;
    const referenceId = await this.insertOne(relEntity, relPayload);
    await this.updateOneById(entity, id, { [localField]: referenceId } as UpdatePayload<E>);
  }

  abstract readonly hasOpenTransaction: boolean;

  /**
   * Runs `callback` in a transaction: begin, commit on success, roll back on failure.
   *
   * The single place that sequence is written; everything else delegates here, because both subtleties
   * below were got wrong by code that hand-rolled it:
   *
   * - `beginTransaction` connects before it begins, so a refused connection lands in the catch with no
   *   transaction open. `rollbackTransaction` is a no-op there rather than an error, which is why a
   *   wrong password no longer surfaces as a transaction-state error.
   * - A rollback that fails too is a consequence of the original failure, not news, so it must not
   *   replace it either.
   *
   * The connection is **not** released here: whoever took it from the pool gives it back, through
   * {@link QuerierPool.transaction}, {@link QuerierPool.withQuerier} or `await using`. Releasing a
   * connection this method never acquired is what forced every caller to know whether it still owned
   * one afterwards.
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

  /**
   * Emit a lifecycle hook event for the given entity.
   * Fires global listeners first, then entity-level hooks.
   */
  private async emitHook<E extends object>(entity: Type<E>, event: HookEvent, payloads: E[]): Promise<void> {
    const listeners = this.extra?.listeners;
    const meta = getMeta(entity);
    const registrations = meta.hooks?.[event];

    // Fast bail-out: skip if no listeners and no entity hooks
    if (!listeners?.length && !registrations?.length) return;

    // Fire global listeners first
    if (listeners?.length) {
      for (const listener of listeners) {
        const fn = listener[event];
        if (fn) {
          const result = fn({ entity, querier: this, payloads, event });
          if (result instanceof Promise) await result;
        }
      }
    }

    // Fire entity-level hooks
    if (registrations?.length) {
      await runHooks(entity, event, payloads, { querier: this });
    }
  }

  /**
   * Runs `task` after everything already queued on this querier, one at a time.
   *
   * @remarks Not re-entrant: only one task runs at a time, so a serialized method awaited from inside
   * another one would wait for a task queued behind itself. Callers below keep their `serialize` calls
   * sequential rather than nested.
   */
  protected async serialize<T>(task: () => Promise<T>): Promise<T> {
    const res = this.taskQueue.then(task);
    this.taskQueue = res.catch(() => {});
    return res;
  }

  /**
   * Runs `task`, logs `query` with how long it took, and tags any error it throws with that query.
   *
   * A method rather than the `@Log()` decorator it replaces. A standard-spec method decorator works by
   * returning a replacement function, and a replacement cannot carry the original's type parameters, so
   * decorating `internalFindMany<E extends Document>` made its signature unresolvable. Most of the query
   * surface is generic like that, and wrapping at the call site costs one line while keeping the
   * signature intact.
   */
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
   * Rolls back an unfinished transaction, then hands the connection back.
   *
   * @remarks Refusing to release was the opposite of safe: the throw came *before* the connection went
   * back, so it destroyed the error that got here and cost the pool a connection with a live `BEGIN` on
   * it. It is also the only option `await using` can reach, which calls `Symbol.asyncDispose` with no
   * arguments and discards what it returns.
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
