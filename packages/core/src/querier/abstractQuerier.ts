import { getMeta } from '../entity/decorator/index.js';
import { GenericRepository } from '../repository/index.js';
import type {
  ExtraOptions,
  IdValue,
  Key,
  Querier,
  Query,
  QueryConflictPaths,
  QueryOne,
  QueryOptions,
  QuerySearch,
  QuerySelect,
  QueryUpdateResult,
  RelationKey,
  RelationValue,
  Repository,
  Type,
} from '../type/index.js';
import {
  augmentWhere,
  clone,
  filterPersistableRelationKeys,
  filterRelationKeys,
  getKeys,
  LoggerWrapper,
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
    this.logger = new LoggerWrapper(extra?.logger, extra?.slowQueryThreshold);
  }

  findOneById<E>(entity: Type<E>, id: IdValue<E>, q: QueryOne<E> = {}) {
    const meta = getMeta(entity);
    q.$where = augmentWhere(meta, q.$where, id);
    return this.findOne(entity, q);
  }

  async findOne<E>(entity: Type<E>, q: QueryOne<E>) {
    const rows = await this.findMany(entity, { ...q, $limit: 1 });
    return rows[0];
  }

  abstract findMany<E>(entity: Type<E>, q: Query<E>): Promise<E[]>;

  findManyAndCount<E>(entity: Type<E>, q: Query<E>) {
    const qCount = {
      ...q,
    } satisfies QuerySearch<E>;
    delete qCount.$sort;
    delete qCount.$limit;
    delete qCount.$skip;
    return Promise.all([this.findMany(entity, q), this.count(entity, qCount)]);
  }

  abstract count<E>(entity: Type<E>, q: QuerySearch<E>): Promise<number>;

  async insertOne<E>(entity: Type<E>, payload: E) {
    const [id] = await this.insertMany(entity, [payload]);
    return id;
  }

  abstract insertMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E) {
    return this.updateMany(entity, { $where: id }, payload);
  }

  abstract updateMany<E>(entity: Type<E>, q: QuerySearch<E>, payload: E): Promise<number>;

  abstract upsertOne<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): Promise<QueryUpdateResult>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions) {
    return this.deleteMany(entity, { $where: id }, opts);
  }

  abstract deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number>;

  async saveOne<E>(entity: Type<E>, payload: E) {
    const [id] = await this.saveMany(entity, [payload]);
    return id;
  }

  async saveMany<E>(entity: Type<E>, payload: E[]) {
    const meta = getMeta(entity);
    const ids: IdValue<E>[] = [];
    const updates: E[] = [];
    const inserts: E[] = [];

    for (const it of payload) {
      if (it[meta.id]) {
        if (getKeys(it).length === 1) {
          ids.push(it[meta.id]);
        } else {
          updates.push(it);
        }
      } else {
        inserts.push(it);
      }
    }

    return Promise.all([
      ...ids,
      ...(inserts.length ? await this.insertMany(entity, inserts) : []),
      ...updates.map(async (it) => {
        const { [meta.id]: id, ...data } = it;
        await this.updateOneById(entity, id, data as E);
        return id;
      }),
    ]);
  }

  protected async fillToManyRelations<E>(entity: Type<E>, payload: E[], select: QuerySelect<E>) {
    if (!payload.length) {
      return;
    }

    const meta = getMeta(entity);
    const relKeys = filterRelationKeys(meta, select);

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      type RelEntity = typeof relEntity;
      const relSelect = clone(select[relKey as string]);
      const relQuery: Query<RelEntity> =
        relSelect === true || relSelect === undefined
          ? {}
          : Array.isArray(relSelect)
            ? { $select: relSelect }
            : relSelect;
      const ids = payload.map((it) => it[meta.id]);

      if (relOpts.through) {
        const localField = relOpts.references[0].local;
        const throughEntity = relOpts.through();
        const throughMeta = getMeta(throughEntity);
        const targetRelKey = getKeys(throughMeta.relations).find((key) =>
          throughMeta.relations[key].references.some(({ local }) => local === relOpts.references[1].local),
        );
        const throughFounds = await this.findMany(throughEntity, {
          ...relQuery,
          $select: {
            [localField]: true,
            [targetRelKey]: {
              ...relQuery,
              $required: true,
            },
          },
          $where: {
            ...relQuery.$where,
            [localField]: ids,
          },
        });
        const founds = throughFounds.map((it) => ({ ...it[targetRelKey], [localField]: it[localField] }));
        this.putChildrenInParents(payload, founds, meta.id, localField, relKey);
      } else if (relOpts.cardinality === '1m') {
        const foreignField = relOpts.references[0].foreign;
        if (relQuery.$select) {
          if (Array.isArray(relQuery.$select)) {
            if (!relQuery.$select.includes(foreignField as Key<RelEntity>)) {
              relQuery.$select.push(foreignField as Key<RelEntity>);
            }
          } else if (!relQuery.$select[foreignField]) {
            relQuery.$select[foreignField] = true;
          }
        }
        relQuery.$where = { ...relQuery.$where, [foreignField]: ids };
        const founds = await this.findMany(relEntity, relQuery);
        this.putChildrenInParents(payload, founds, meta.id, foreignField, relKey);
      }
    }
  }

  protected putChildrenInParents<E>(
    parents: E[],
    children: E[],
    parentIdKey: string,
    referenceKey: string,
    relKey: string,
  ): void {
    const childrenByParentMap = children.reduce((acc, child) => {
      const parenId = child[referenceKey];
      if (!acc[parenId]) {
        acc[parenId] = [];
      }
      acc[parenId].push(child);
      return acc;
    }, {});

    for (const parent of parents) {
      const parentId = parent[parentIdKey];
      parent[relKey] = childrenByParentMap[parentId];
    }
  }

  protected async insertRelations<E>(entity: Type<E>, payload: E[]) {
    const meta = getMeta(entity);
    await Promise.all(
      payload.map((it) => {
        const relKeys = filterPersistableRelationKeys(meta, it, 'persist');
        if (!relKeys.length) {
          return Promise.resolve();
        }
        return Promise.all(relKeys.map((relKey) => this.saveRelation(entity, it, relKey)));
      }),
    );
  }

  protected async updateRelations<E>(entity: Type<E>, q: QuerySearch<E>, payload: E) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, payload, 'persist');

    if (!relKeys.length) {
      return;
    }

    const founds = await this.findMany(entity, { ...q, $select: [meta.id] });
    const ids = founds.map((found) => found[meta.id]);

    await Promise.all(
      ids.map((id) =>
        Promise.all(relKeys.map((relKey) => this.saveRelation(entity, { ...payload, [meta.id]: id }, relKey, true))),
      ),
    );
  }

  protected async deleteRelations<E>(entity: Type<E>, ids: IdValue<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const relKeys = filterPersistableRelationKeys(meta, meta.relations as E, 'delete');

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      const localField = relOpts.references[0].local;
      if (relOpts.through) {
        const throughEntity = relOpts.through();
        await this.deleteMany(throughEntity, { $where: { [localField]: ids } }, opts);
        return;
      }
      await this.deleteMany(relEntity, { [localField]: ids }, opts);
    }
  }

  protected async saveRelation<E>(entity: Type<E>, payload: E, relKey: RelationKey<E>, isUpdate?: boolean) {
    const meta = getMeta(entity);
    const id = payload[meta.id];
    const { entity: entityGetter, cardinality, references, through } = meta.relations[relKey];
    const relEntity = entityGetter();
    const relPayload = payload[relKey] as unknown as RelationValue<E>[];

    if (cardinality === '1m' || cardinality === 'mm') {
      if (through) {
        const localField = references[0].local;

        const throughEntity = through();
        if (isUpdate) {
          await this.deleteMany(throughEntity, { $where: { [localField]: id } });
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
        await this.deleteMany(relEntity, { $where: { [foreignField]: id } });
      }
      if (relPayload) {
        for (const it of relPayload) {
          it[foreignField] = id;
        }
        await this.saveMany(relEntity, relPayload);
      }
      return;
    }

    if (cardinality === '11') {
      const foreignField = references[0].foreign;
      if (relPayload === null) {
        await this.deleteMany(relEntity, { $where: { [foreignField]: id } });
        return;
      }
      await this.saveOne(relEntity, { ...relPayload, [foreignField]: id });
      return;
    }

    if (cardinality === 'm1' && relPayload) {
      const localField = references[0].local;
      const referenceId = await this.insertOne(relEntity, relPayload);
      await this.updateOneById(entity, id, { [localField]: referenceId });
      return;
    }
  }

  getRepository<E>(entity: Type<E>): Repository<E> {
    return new GenericRepository(entity, this);
  }

  abstract readonly hasOpenTransaction: boolean;

  async transaction<T>(callback: () => Promise<T>) {
    try {
      await this.beginTransaction();
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

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  protected abstract internalRelease(): Promise<void>;

  @Serialized()
  async release(): Promise<void> {
    return this.internalRelease();
  }
}
