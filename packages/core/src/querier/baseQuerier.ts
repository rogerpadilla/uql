import {
  IdValue,
  Querier,
  Query,
  QueryCriteria,
  QueryOne,
  QueryOptions,
  QueryProject,
  QuerySearch,
  RelationKey,
  RelationValue,
  Repository,
  Type,
} from '../type';
import { getMeta } from '../entity/decorator';
import { clone, getKeys } from '../util';
import { getProjectRelationKeys, getPersistableRelations } from './querier.util';
import { BaseRepository } from './baseRepository';

export abstract class BaseQuerier implements Querier {
  abstract count<E>(entity: Type<E>, qm?: QuerySearch<E>): Promise<number>;

  findOneById<E>(entity: Type<E>, id: IdValue<E>, qo: QueryOne<E> = {}) {
    return this.findOne(entity, { ...qo, $filter: id });
  }

  async findOne<E>(entity: Type<E>, qm: QueryOne<E>) {
    qm.$limit = 1;
    const rows = await this.findMany(entity, qm);
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
        await this.updateOneById(entity, it[meta.id], it);
        return it[meta.id];
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
      const referenceKey = relOpts.references[0].source;
      const ids: IdValue<E>[] = payload.map((it) => it[meta.id]);

      if (relOpts.through) {
        const throughEntity = relOpts.through();
        const throughMeta = getMeta(throughEntity);
        const targetRelKey = getKeys(throughMeta.relations)[relOpts.mappedBy ? 0 : 1];
        const throughFounds = await this.findMany(throughEntity, {
          $project: {
            [referenceKey]: true,
            [targetRelKey]: {
              ...relQuery,
              $required: true,
            },
          },
          $filter: {
            [referenceKey]: ids,
          },
        });
        const founds = throughFounds.map((it) => ({ ...it[targetRelKey], [referenceKey]: it[referenceKey] }));
        this.putChildrenInParents(payload, founds, meta.id, referenceKey, relKey);
      } else if (relOpts.cardinality === '1m') {
        if (relQuery.$project) {
          if (Array.isArray(relQuery.$project)) {
            if (!relQuery.$project.includes(referenceKey)) {
              relQuery.$project.push(referenceKey);
            }
          } else if (!relQuery.$project[referenceKey]) {
            relQuery.$project[referenceKey] = true;
          }
        }
        relQuery.$filter = { [referenceKey]: ids };
        const founds = await this.findMany(relEntity, relQuery);
        this.putChildrenInParents(payload, founds, meta.id, referenceKey, relKey);
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

    const ids: IdValue<E>[] = founds.map((found) => found[meta.id]);

    await Promise.all(ids.map((id) => Promise.all(relKeys.map((relKey) => this.saveRelation(entity, { ...payload, [meta.id]: id }, relKey, true)))));
  }

  protected async deleteRelations<E>(entity: Type<E>, ids: IdValue<E>[], opts?: QueryOptions) {
    const meta = getMeta(entity);
    const relKeys = getPersistableRelations(meta, meta.relations as E, 'delete');

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      if (relOpts.through) {
        const throughEntity = relOpts.through();
        const referenceKey = relOpts.mappedBy ? relOpts.references[1].source : relOpts.references[0].source;
        await this.deleteMany(throughEntity, { $filter: { [referenceKey]: ids } }, opts);
        return;
      }
      const referenceKey = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
      await this.deleteMany(relEntity, { [referenceKey]: ids }, opts);
    }
  }

  protected async saveRelation<E>(entity: Type<E>, payload: E, relKey: RelationKey<E>, isUpdate?: boolean) {
    const meta = getMeta(entity);
    const id = payload[meta.id];
    const { entity: entityGetter, cardinality, references, through } = meta.relations[relKey];
    const relEntity = entityGetter();
    const relPayload = payload[relKey] as RelationValue<E>[];

    if (cardinality === '1m' || cardinality === 'mm') {
      const referenceKey = references[0].source;

      if (through) {
        const throughEntity = through();
        if (isUpdate) {
          await this.deleteMany(throughEntity, { $filter: { [referenceKey]: id } });
        }
        if (relPayload) {
          const savedIds = await this.saveMany(relEntity, relPayload);
          const throughBodies = savedIds.map((relId) => ({
            [references[0].source]: id,
            [references[1].source]: relId,
          }));
          await this.insertMany(throughEntity, throughBodies);
        }
        return;
      }
      if (isUpdate) {
        await this.deleteMany(relEntity, { $filter: { [referenceKey]: id } });
      }
      if (relPayload) {
        for (const it of relPayload) {
          it[referenceKey] = id;
        }
        await this.saveMany(relEntity, relPayload);
      }
      return;
    }

    if (cardinality === '11') {
      const referenceKey = references[0].target;
      if (relPayload === null) {
        await this.deleteMany(relEntity, { $filter: { [referenceKey]: id } });
        return;
      }
      await this.saveOne(relEntity, { ...relPayload, [referenceKey]: id });
      return;
    }

    if (cardinality === 'm1') {
      const referenceKey = references[0].source;
      if (payload[referenceKey]) {
        return;
      }
      if (relPayload) {
        const referenceId = await this.insertOne(relEntity, relPayload);
        await this.updateOneById(entity, id, { [referenceKey]: referenceId });
      }
      return;
    }
  }

  getRepository<E>(entity: Type<E>): Repository<E> {
    return new BaseRepository(entity, this);
  }

  abstract readonly hasOpenTransaction: boolean;

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  abstract release(): Promise<void>;
}
