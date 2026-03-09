import { getMeta } from '../entity/decorator/index.js';

import type {
  ExtraOptions,
  HookEvent,
  IdKey,
  IdValue,
  LoggingOptions,
  Querier,
  Query,
  QueryAggregate,
  QueryConflictPaths,
  QueryOne,
  QueryOptions,
  QuerySearch,
  QuerySelect,
  QueryUpdateResult,
  QueryWhere,
  RawRow,
  RelationKey,
  RelationOptions,
  RelationValue,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import {
  augmentWhere,
  clone,
  filterPersistableRelationKeys,
  filterRelationKeys,
  getKeys,
  LoggerWrapper,
  runHooks,
} from '../util/index.js';
import { Serialized } from './decorator/index.js';

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
  protected readonly logger: LoggerWrapper;

  constructor(readonly extra?: ExtraOptions) {
    this.logger = new LoggerWrapper(extra?.logger as LoggingOptions, extra?.slowQuery);
  }

  /**
   * Resolves entity from either a separate argument or from $entity field in query.
   * @param entityOrQuery - Entity class or query object with $entity
   * @param maybeQuery - Query object if entity was passed separately
   * @returns Tuple of [entity, query]
   */
  protected resolveEntityAndQuery<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    maybeQuery?: QuerySearch<E>,
  ): [Type<E>, QuerySearch<E>] {
    // Check if first argument is a class (function with prototype)
    if (typeof entityOrQuery === 'function' && entityOrQuery.prototype) {
      return [entityOrQuery as Type<E>, maybeQuery ?? {}];
    }
    // Otherwise it's a query object with $entity
    const q = entityOrQuery as QuerySearch<E> & { $entity: Type<E> };
    if (!q.$entity) {
      throw new TypeError('$entity is required when using query-object syntax');
    }
    const { $entity, ...query } = q;
    return [$entity, query as QuerySearch<E>];
  }

  findOneById<E extends object>(entity: Type<E>, id: IdValue<E>, q: QueryOne<E> = {}): Promise<E | undefined> {
    const meta = getMeta(entity);
    q.$where = augmentWhere(meta, q.$where, id);
    return this.findOne(entity, q);
  }

  /**
   * Find a single record matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  async findOne<E extends object>(entity: Type<E>, q: QueryOne<E>): Promise<E | undefined>;
  async findOne<E extends object>(q: QueryOne<E> & { $entity: Type<E> }): Promise<E | undefined>;
  async findOne<E extends object>(
    entityOrQuery: Type<E> | (QueryOne<E> & { $entity: Type<E> }),
    maybeQuery?: QueryOne<E>,
  ): Promise<E | undefined> {
    const [entity, q] = this.resolveEntityAndQuery(entityOrQuery, maybeQuery);
    const rows = await this.findMany(entity, { ...q, $limit: 1 });
    return rows[0];
  }

  /**
   * Find multiple records matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  findMany<E extends object>(entity: Type<E>, q: Query<E>): Promise<E[]>;
  findMany<E extends object>(q: Query<E> & { $entity: Type<E> }): Promise<E[]>;
  async findMany<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQuery?: Query<E>,
  ): Promise<E[]> {
    const [entity, q] = this.resolveEntityAndQuery(entityOrQuery, maybeQuery);
    const founds = await this.internalFindMany(entity, q as Query<E>);
    await this.emitHook(entity, 'afterLoad', founds);
    return founds;
  }

  protected abstract internalFindMany<E extends object>(entity: Type<E>, q: Query<E>): Promise<E[]>;

  /**
   * Find multiple records and return both the records and total count.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>): Promise<[E[], number]>;
  findManyAndCount<E extends object>(q: Query<E> & { $entity: Type<E> }): Promise<[E[], number]>;
  async findManyAndCount<E extends object>(
    entityOrQuery: Type<E> | (Query<E> & { $entity: Type<E> }),
    maybeQuery?: Query<E>,
  ): Promise<[E[], number]> {
    const [entity, q] = this.resolveEntityAndQuery(entityOrQuery, maybeQuery);
    const { $sort: _, $limit: _l, $skip: _s, ...qCount } = q as Query<E>;
    const [founds, count] = await Promise.all([
      this.internalFindMany(entity, q as Query<E>),
      this.internalCount(entity, qCount),
    ]);
    await this.emitHook(entity, 'afterLoad', founds);
    return [founds, count];
  }

  /**
   * Count records matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  count<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;
  count<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }): Promise<number>;
  count<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    maybeQuery?: QuerySearch<E>,
  ): Promise<number> {
    const [entity, q] = this.resolveEntityAndQuery(entityOrQuery, maybeQuery);
    return this.internalCount(entity, q);
  }

  protected abstract internalCount<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  /**
   * Run an aggregate query.
   */
  aggregate<E extends object, R extends Record<string, unknown> = Record<string, unknown>>(
    entity: Type<E>,
    q: QueryAggregate<E>,
  ): Promise<R[]> {
    return this.internalAggregate(entity, q) as Promise<R[]>;
  }

  protected abstract internalAggregate<E extends object>(
    entity: Type<E>,
    q: QueryAggregate<E>,
  ): Promise<Record<string, unknown>[]>;

  async insertOne<E extends object>(entity: Type<E>, payload: E) {
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

  updateOneById<E extends object>(entity: Type<E>, id: IdValue<E>, payload: UpdatePayload<E>) {
    return this.updateMany(entity, { $where: id }, payload);
  }

  async updateMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>): Promise<number> {
    await this.emitHook(entity, 'beforeUpdate', [payload as E]);
    const changes = await this.internalUpdateMany(entity, q, payload);
    await this.emitHook(entity, 'afterUpdate', [payload as E]);
    return changes;
  }

  protected abstract internalUpdateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
  ): Promise<number>;

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
   * Delete records matching the query.
   * Supports both entity-as-argument and entity-as-field patterns.
   */
  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;
  deleteMany<E extends object>(q: QuerySearch<E> & { $entity: Type<E> }, opts?: QueryOptions): Promise<number>;
  async deleteMany<E extends object>(
    entityOrQuery: Type<E> | (QuerySearch<E> & { $entity: Type<E> }),
    qOrOpts?: QuerySearch<E> | QueryOptions,
    maybeOpts?: QueryOptions,
  ): Promise<number> {
    let entity: Type<E>;
    let q: QuerySearch<E>;
    let opts: QueryOptions | undefined;

    if (typeof entityOrQuery === 'function' && entityOrQuery.prototype) {
      entity = entityOrQuery as Type<E>;
      q = qOrOpts as QuerySearch<E>;
      opts = maybeOpts;
    } else {
      const { $entity, ...rest } = entityOrQuery as QuerySearch<E> & { $entity: Type<E> };
      entity = $entity;
      q = rest as QuerySearch<E>;
      opts = qOrOpts as QueryOptions;
    }

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

  protected async fillToManyRelations<E>(entity: Type<E>, payload: E[], select: QuerySelect<E>) {
    if (!payload.length) {
      return;
    }

    const meta = getMeta(entity);
    const relKeys = filterRelationKeys(meta, select);

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relEntity = relOpts.entity!();
      type RelEntity = typeof relEntity;
      const relSelect = clone((select as Record<string, unknown>)[relKey]);
      const relQuery: Query<RelEntity> = relSelect === true || !relSelect ? {} : relSelect;
      const ids = payload.map((it) => it[meta.id!]);

      if (relOpts.through) {
        const localField = relOpts.references![0].local;
        const throughEntity = relOpts.through();
        const throughMeta = getMeta(throughEntity);
        const targetRelKey = getKeys(throughMeta.relations).find((key) =>
          throughMeta.relations[key]!.references!.some(({ local }) => local === relOpts.references![1].local),
        );
        const throughFounds = await this.findMany(throughEntity, {
          ...relQuery,
          $select: {
            [localField!]: true,
            [targetRelKey!]: {
              ...relQuery,
              $required: true,
            },
          },
          $where: {
            ...relQuery.$where,
            [localField!]: ids,
          },
        });
        const founds = (throughFounds as unknown as RawRow[]).map((it) => ({
          ...(it[targetRelKey!] as RawRow),
          [localField!]: it[localField!],
        }));
        this.putChildrenInParents(payload, founds, meta.id!, localField!, relKey);
      } else if (relOpts.cardinality === '1m') {
        const foreignField = relOpts.references![0].foreign;
        if (relQuery.$select) {
          if (!(relQuery.$select as Record<string, unknown>)[foreignField]) {
            (relQuery.$select as Record<string, unknown>)[foreignField] = true;
          }
        }
        relQuery.$where = { ...relQuery.$where, [foreignField!]: ids };
        const founds = await this.findMany(relEntity, relQuery);
        this.putChildrenInParents(payload, founds, meta.id!, foreignField!, relKey);
      }
    }
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
      parent[relKey] = childrenByParentId[String(parent[parentIdKey!])] as E[keyof E & string];
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

  protected async updateRelations<E extends object>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, payload as E, 'persist');

    if (!relKeys.length) {
      return;
    }

    const founds = await this.findMany(entity, { ...q, $select: { [meta.id!]: true } } as Query<E>);
    const ids = founds.map((found) => found[meta.id!]);

    await Promise.all(
      ids.map((id) =>
        Promise.all(
          relKeys.map((relKey) => this.saveRelation(entity, { ...payload, [meta.id!]: id } as E, relKey, true)),
        ),
      ),
    );
  }

  protected async deleteRelations<E extends object>(entity: Type<E>, ids: IdValue<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, meta.relations as unknown as E, 'delete');

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relEntity = relOpts.entity!();
      const localField = relOpts.references![0].local;
      if (relOpts.through) {
        const throughEntity = relOpts.through();
        await this.deleteMany(throughEntity, { $where: { [localField!]: ids } }, opts);
      } else {
        const foreignField = relOpts.references![0].foreign;
        await this.deleteMany(relEntity, { $where: { [foreignField!]: ids } }, opts);
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
    const id = payload[meta.id!] as IdValue<E>;
    const relOpts = meta.relations[relKey];
    if (!relOpts) return;
    const relEntity = relOpts.entity!();
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
    relOpts: RelationOptions,
    relEntity: Type<object>,
    id: unknown,
    relPayload: object[],
    isUpdate?: boolean,
  ) {
    const { references, through } = relOpts;
    if (through) {
      const localField = references![0].local;
      const throughEntity = through();
      if (isUpdate) {
        await this.deleteMany(throughEntity, { $where: { [localField]: id } as QueryWhere<object> });
      }
      if (relPayload) {
        const savedIds = await this.saveMany(relEntity, relPayload);
        const throughBodies = savedIds.map((relId) => ({
          [references![0].local]: id,
          [references![1].local]: relId,
        }));
        await this.insertMany(throughEntity, throughBodies);
      }
      return;
    }
    const foreignField = references![0].foreign;
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

  private async saveOneToOne(relEntity: Type<object>, relOpts: RelationOptions, id: unknown, relPayload: object) {
    const foreignField = relOpts.references![0].foreign;
    if (relPayload === null) {
      await this.deleteMany(relEntity, { $where: { [foreignField!]: id } as QueryWhere<object> });
      return;
    }
    await this.saveOne(relEntity, { ...relPayload, [foreignField!]: id });
  }

  private async saveManyToOne<E extends object>(
    entity: Type<E>,
    relEntity: Type<object>,
    relOpts: RelationOptions,
    id: IdValue<E>,
    relPayload: object,
  ) {
    const localField = relOpts.references![0].local;
    const referenceId = await this.insertOne(relEntity, relPayload);
    await this.updateOneById(entity, id, { [localField]: referenceId } as E);
  }

  abstract readonly hasOpenTransaction: boolean;

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
      await this.rollbackTransaction();
      throw err;
    } finally {
      await this.release();
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

  async releaseIfFree() {
    if (!this.hasOpenTransaction) {
      await this.internalRelease();
    }
  }

  /**
   * Schedules a task to be executed serially in the querier instance.
   * This is used by the @Serialized decorator to protect database-level operations.
   *
   * @param task - The async task to execute.
   * @returns A promise that resolves with the task's result.
   */
  protected async serialize<T>(task: () => Promise<T>): Promise<T> {
    const res = this.taskQueue.then(task);
    this.taskQueue = res.catch(() => {});
    return res;
  }

  abstract beginTransaction(opts?: TransactionOptions): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  protected abstract internalRelease(): Promise<void>;

  @Serialized()
  async release(): Promise<void> {
    return this.internalRelease();
  }
}
