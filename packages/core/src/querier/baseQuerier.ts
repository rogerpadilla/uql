import {
  FieldValue,
  Querier,
  Query,
  QueryCriteria,
  QueryOne,
  QueryOptions,
  QueryProject,
  RelationKey,
  RelationValue,
  Repository,
  Type,
} from '../type';
import { getMeta } from '../entity/decorator';
import { clone, getKeys } from '../util';
import { getProjectRelations, getPersistableRelations } from './querier.util';
import { BaseRepository } from './baseRepository';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class BaseQuerier implements Querier {
  abstract count<E>(entity: Type<E>, qm?: QueryCriteria<E>): Promise<number>;

  findOneById<E>(entity: Type<E>, id: FieldValue<E>, qo: QueryOne<E> = {}) {
    const meta = getMeta(entity);
    const idName = meta.fields[meta.id].name;
    return this.findOne(entity, { ...qo, $filter: { [idName]: id } });
  }

  async findOne<E>(entity: Type<E>, qm: QueryOne<E>) {
    qm.$limit = 1;
    const rows = await this.findMany(entity, qm);
    return rows[0];
  }

  abstract findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  async insertOne<E>(entity: Type<E>, payload: E) {
    const [id] = await this.insertMany(entity, [payload]);
    return id;
  }

  abstract insertMany<E>(entity: Type<E>, payload: E[]): Promise<any[]>;

  updateOneById<E>(entity: Type<E>, payload: E, id: FieldValue<E>) {
    const meta = getMeta(entity);
    return this.updateMany(entity, payload, { $filter: { [meta.id]: id } });
  }

  abstract updateMany<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: FieldValue<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    return this.deleteMany(entity, { $filter: { [meta.id]: id } }, opts);
  }

  abstract deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;

  protected async findToManyRelations<E>(entity: Type<E>, payload: E[], project: QueryProject<E>) {
    const meta = getMeta(entity);
    const relations = getProjectRelations(meta, project);

    for (const relKey of relations) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      const relQuery = clone(project[relKey as string]);
      const referenceKey = relOpts.references[0].source;
      const ids = payload.map((it) => it[meta.id]);

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
        const founds = throughFounds.map((it) => it[targetRelKey]);
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
        relQuery.$filter = { [referenceKey]: { $in: ids } };
        const founds = await this.findMany(relEntity, relQuery);
        this.putChildrenInParents(payload, founds, meta.id, referenceKey, relKey);
      }
    }
  }

  protected putChildrenInParents<E>(
    parents: E[],
    children: E[],
    parentIdKey: string,
    referenceKey: string,
    relKey: string
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
        const keys = getPersistableRelations(meta, it, 'persist');
        if (!keys.length) {
          return;
        }
        return Promise.all(keys.map((key) => this.saveRelation(entity, it, key)));
      })
    );
  }

  protected async updateRelations<E>(entity: Type<E>, payload: E, criteria: QueryCriteria<E>) {
    const meta = getMeta(entity);
    const keys = getPersistableRelations(meta, payload, 'persist');

    if (!keys.length) {
      return;
    }

    const founds = await this.findMany(entity, {
      ...criteria,
      $project: [meta.id],
    });

    const ids = founds.map((found) => found[meta.id]);

    await Promise.all(
      ids.map((id) =>
        Promise.all(keys.map((relKey) => this.saveRelation(entity, { ...payload, [meta.id]: id }, relKey, true)))
      )
    );
  }

  protected async deleteRelations<E>(entity: Type<E>, ids: FieldValue<E>[], opts?: QueryOptions): Promise<void> {
    const meta = getMeta(entity);
    const relKeys = getPersistableRelations(meta, meta.relations as E, 'delete');

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      if (relOpts.through) {
        const throughEntity = relOpts.through();
        const referenceKey = relOpts.mappedBy ? relOpts.references[1].source : relOpts.references[0].source;
        await this.deleteMany(throughEntity, { [referenceKey]: ids }, opts);
        return;
      }
      const referenceKey = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
      await this.deleteMany(relEntity, { [referenceKey]: ids }, opts);
    }
  }

  protected async saveMany<E>(entity: Type<E>, payload: E[]): Promise<any[]> {
    const meta = getMeta(entity);
    const inserts: E[] = [];
    const updates: E[] = [];
    const links: any[] = [];

    for (const it of payload) {
      if (it[meta.id]) {
        if (getKeys(it).length === 1) {
          links.push(it[meta.id]);
        } else {
          updates.push(it);
        }
      } else {
        inserts.push(it);
      }
    }

    return Promise.all([
      ...links,
      ...(inserts.length ? await this.insertMany(entity, inserts) : []),
      ...updates.map(async (it) => {
        await this.updateOneById(entity, it, it[meta.id]);
        return it[meta.id];
      }),
    ]);
  }

  protected async saveRelation<E>(
    entity: Type<E>,
    payload: E,
    relKey: RelationKey<E>,
    isUpdate?: boolean
  ): Promise<void> {
    const meta = getMeta(entity);
    const id = payload[meta.id];
    const { entity: entityGetter, cardinality, references, through } = meta.relations[relKey];
    const relEntity = entityGetter();
    const relPayload = payload[relKey] as RelationValue<E>[];

    if (cardinality === '1m' || cardinality === 'mm') {
      const referenceKey = references[0].source;

      if (through) {
        const throughEntity = through();
        await this.deleteMany(throughEntity, { $filter: { [referenceKey]: id } });
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
      await this.saveMany(relEntity, [{ ...relPayload, [referenceKey]: id }]);
      return;
    }

    if (cardinality === 'm1') {
      const referenceKey = references[0].source;
      if (payload[referenceKey]) {
        return;
      }
      if (relPayload) {
        const referenceId = await this.insertOne(relEntity, relPayload);
        await this.updateOneById(entity, { [referenceKey]: referenceId }, id);
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
