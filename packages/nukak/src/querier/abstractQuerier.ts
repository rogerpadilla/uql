import {
  IdValue,
  Querier,
  Query,
  QueryCriteria,
  QueryOne,
  QueryOptions,
  QueryProject,
  QuerySearch,
  QueryUnique,
  RelationKey,
  RelationValue,
  Repository,
  Type,
} from '../type/index.js';
import { getMeta } from '../entity/decorator/index.js';
import { clone, getKeys, getProjectRelationKeys, getPersistableRelations } from '../util/index.js';
import { GenericRepository } from '../repository/index.js';

export abstract class AbstractQuerier implements Querier {
  abstract count<E>(entity: Type<E>, qm?: QuerySearch<E>): Promise<number>;

  findOneById<E>(entity: Type<E>, id: IdValue<E>, qm: QueryUnique<E> = {}) {
    return this.findOne(entity, { ...qm, $filter: id });
  }

  async findOne<E>(entity: Type<E>, qm: QueryOne<E>) {
    const rows = await this.findMany(entity, { ...qm, $limit: 1 });
    return rows[0];
  }

  abstract findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>) {
    return Promise.all([this.findMany(entity, qm), this.count(entity, qm)]);
  }

  async insertOne<E>(entity: Type<E>, payload: E) {
    const [id] = await this.insertMany(entity, [payload]);
    return id;
  }

  abstract insertMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E) {
    return this.updateMany(entity, { $filter: id }, payload);
  }

  abstract updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions) {
    return this.deleteMany(entity, { $filter: id }, opts);
  }

  abstract deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;

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

  protected async findToManyRelations<E>(entity: Type<E>, payload: E[], project: QueryProject<E>) {
    const meta = getMeta(entity);
    const relations = getProjectRelationKeys(meta, project);

    for (const relKey of relations) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      const relProject = clone(project[relKey as string]);
      const relQuery: Query<any> =
        relProject === true || relProject === undefined ? {} : Array.isArray(relProject) ? { $project: relProject } : relProject;
      const ids = payload.map((it) => it[meta.id]);

      if (relOpts.through) {
        const localField = relOpts.references[0].local;
        const throughEntity = relOpts.through();
        const throughMeta = getMeta(throughEntity);
        const targetRelKey = Object.keys(throughMeta.relations).find((key) =>
          throughMeta.relations[key].references.some(({ local }) => local === relOpts.references[1].local)
        );
        const throughFounds = await this.findMany(throughEntity, {
          $project: {
            [localField]: true,
            [targetRelKey]: {
              ...relQuery,
              $required: true,
            },
          },
          $filter: {
            [localField]: ids,
          },
        });
        const founds = throughFounds.map((it) => ({ ...it[targetRelKey], [localField]: it[localField] }));
        this.putChildrenInParents(payload, founds, meta.id, localField, relKey);
      } else if (relOpts.cardinality === '1m') {
        const foreignField = relOpts.references[0].foreign;
        if (relQuery.$project) {
          if (Array.isArray(relQuery.$project)) {
            if (!relQuery.$project.includes(foreignField)) {
              relQuery.$project.push(foreignField);
            }
          } else if (!relQuery.$project[foreignField]) {
            relQuery.$project[foreignField] = true;
          }
        }
        relQuery.$filter = { [foreignField]: ids };
        const founds = await this.findMany(relEntity, relQuery);
        this.putChildrenInParents(payload, founds, meta.id, foreignField, relKey);
      }
    }
  }

  protected putChildrenInParents<E>(parents: E[], children: E[], parentIdKey: string, referenceKey: string, relKey: string): void {
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
        const relKeys = getPersistableRelations(meta, it, 'persist');
        if (!relKeys.length) {
          return;
        }
        return Promise.all(relKeys.map((relKey) => this.saveRelation(entity, it, relKey)));
      })
    );
  }

  protected async updateRelations<E>(entity: Type<E>, criteria: QueryCriteria<E>, payload: E) {
    const meta = getMeta(entity);
    const relKeys = getPersistableRelations(meta, payload, 'persist');

    if (!relKeys.length) {
      return;
    }

    const founds = await this.findMany(entity, {
      ...criteria,
      $project: [meta.id],
    });

    const ids = founds.map((found) => found[meta.id]);

    await Promise.all(ids.map((id) => Promise.all(relKeys.map((relKey) => this.saveRelation(entity, { ...payload, [meta.id]: id }, relKey, true)))));
  }

  protected async deleteRelations<E>(entity: Type<E>, ids: IdValue<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const relKeys = getPersistableRelations(meta, meta.relations as E, 'delete');

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      const localField = relOpts.references[0].local;
      if (relOpts.through) {
        const throughEntity = relOpts.through();
        await this.deleteMany(throughEntity, { $filter: { [localField]: ids } }, opts);
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
          await this.deleteMany(throughEntity, { $filter: { [localField]: id } });
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
        await this.deleteMany(relEntity, { $filter: { [foreignField]: id } });
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
        await this.deleteMany(relEntity, { $filter: { [foreignField]: id } });
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

  async transaction<T>(callback: (querier?: ThisType<Querier>) => Promise<T>) {
    try {
      await this.beginTransaction();
      const res = await callback(this);
      await this.commitTransaction();
      return res;
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    } finally {
      await this.release();
    }
  }

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  abstract release(): Promise<void>;

  abstract end(): Promise<void>;
}
