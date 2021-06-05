import {
  EntityMeta,
  Properties,
  Querier,
  Query,
  QueryCriteria,
  QueryOne,
  QueryPopulate,
  RelationOptions,
  Repository,
  Type,
} from '../type';
import { getMeta } from '../entity/decorator';
import { cloneDeep, objectKeys } from '../util';
import { BaseRepository } from './baseRepository';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class BaseQuerier implements Querier {
  abstract insertMany<E>(entity: Type<E>, payload: E[]): Promise<any[]>;

  async insertOne<E>(entity: Type<E>, payload: E) {
    const [id] = await this.insertMany(entity, [payload]);
    return id;
  }

  abstract updateMany<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): Promise<number>;

  updateOneById<E>(entity: Type<E>, payload: E, id: any) {
    const meta = getMeta(entity);
    return this.updateMany(entity, payload, { $filter: { [meta.id.property]: id } });
  }

  abstract findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  async findOne<E>(entity: Type<E>, qm: QueryOne<E>) {
    qm.$limit = 1;
    const rows = await this.findMany(entity, qm);
    return rows[0];
  }

  findOneById<E>(type: Type<E>, id: any, qo: QueryOne<E> = {}) {
    const meta = getMeta(type);
    return this.findOne(type, { ...qo, $filter: { [meta.id.name]: id } });
  }

  abstract deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: any) {
    const meta = getMeta(entity);
    return this.deleteMany(entity, { $filter: { [meta.id.name]: id } });
  }

  abstract count<E>(entity: Type<E>, qm?: QueryCriteria<E>): Promise<number>;

  abstract readonly hasOpenTransaction: boolean;

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  abstract release(): Promise<void>;

  protected async populateToManyRelations<E>(entity: Type<E>, payload: E[], populate: QueryPopulate<E>) {
    const meta = getMeta(entity);

    for (const relKey in populate) {
      const relOpts = meta.relations[relKey];

      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${relKey}' is not annotated as a relation`);
      }

      const relEntity = relOpts.entity();
      const relQuery = cloneDeep(populate[relKey] as Query<typeof relEntity>);
      const sourceProp = relOpts.references[0].source;
      const ids = payload.map((it) => it[meta.id.property]);

      if (relOpts.cardinality === 'mm') {
        const throughEntity = relOpts.through();
        const throughMeta = getMeta(throughEntity);
        const targetRelKey = objectKeys(throughMeta.relations)[relOpts.mappedBy ? 0 : 1];
        const throughFounds = await this.findMany(throughEntity, {
          $project: [sourceProp],
          $filter: {
            [sourceProp]: ids,
          },
          $populate: {
            [targetRelKey]: {
              ...relQuery,
              $required: true,
            },
          },
        });
        const founds = throughFounds.map((it) => it[targetRelKey]);
        this.putRelationsInParents(payload, founds, meta.id.property, sourceProp, relKey);
      } else if (relOpts.cardinality === '1m') {
        if (relQuery.$project) {
          if (Array.isArray(relQuery.$project)) {
            if (!relQuery.$project.includes(sourceProp)) {
              relQuery.$project.push(sourceProp);
            }
          } else if (!relQuery.$project[sourceProp]) {
            relQuery.$project[sourceProp] = true;
          }
        }
        relQuery.$filter = { [sourceProp]: { $in: ids } };
        const founds = await this.findMany(relEntity, relQuery);
        this.putRelationsInParents(payload, founds, meta.id.property, sourceProp, relKey);
      }
    }
  }

  protected putRelationsInParents<E>(
    parents: E[],
    children: E[],
    parentId: string,
    parentSource: string,
    relKey: string
  ): void {
    const childrenMap = children.reduce((acc, it) => {
      const attr = it[parentSource];
      if (!acc[attr]) {
        acc[attr] = [];
      }
      acc[attr].push(it);
      return acc;
    }, {});

    for (const it of parents) {
      it[relKey] = childrenMap[it[parentId]];
    }
  }

  protected async insertRelations<E>(entity: Type<E>, payload: E[]) {
    const meta = getMeta(entity);
    await Promise.all(
      payload.map((it) => {
        const relKeys = getIndependentRelations(meta, it);
        if (!relKeys.length) {
          return;
        }
        return Promise.all(
          relKeys.map((relKey) => this.saveRelation(it[meta.id.property], it[relKey], meta.relations[relKey]))
        );
      })
    );
  }

  protected async updateRelations<E>(entity: Type<E>, payload: E, criteria: QueryCriteria<E>) {
    const meta = getMeta(entity);
    const relKeys = getIndependentRelations(meta, payload);

    if (!relKeys.length) {
      return;
    }

    const founds = await this.findMany(entity, {
      ...criteria,
      $project: [meta.id.property] as Properties<E>[],
    });

    const ids = founds.map((found) => found[meta.id.property]);

    await Promise.all(
      ids.map((id) =>
        Promise.all(relKeys.map((relKey) => this.saveRelation(id, payload[relKey], meta.relations[relKey], true)))
      )
    );
  }

  protected async saveMany<E>(entity: Type<E>, payload: E[]): Promise<any[]> {
    const meta = getMeta(entity);
    const inserts: E[] = [];
    const updates: E[] = [];
    const links: any[] = [];

    for (const it of payload) {
      if (it[meta.id.property]) {
        if (objectKeys(it).length === 1) {
          links.push(it[meta.id.property]);
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
        await this.updateOneById(entity, it, it[meta.id.property]);
        return it[meta.id.property];
      }),
    ]);
  }

  protected async saveRelation<E>(
    id: any,
    relPayload: E | E[],
    { entity, mappedBy, cardinality, references, through }: RelationOptions<E>,
    isUpdate?: boolean
  ): Promise<void> {
    const relEntity = entity();

    if (cardinality === '11') {
      const relProperty = mappedBy ? references[0].target : references[0].source;
      if (relPayload === null) {
        await this.deleteMany(relEntity, { $filter: { [relProperty]: id } });
        return;
      }
      await this.saveMany(relEntity, [{ ...(relPayload as E), [relProperty]: id }]);
      return;
    }

    const relPayloads = relPayload as E[];
    const relProperty = references[0].source;

    if (through) {
      const throughEntity = through();
      await this.deleteMany(throughEntity, { $filter: { [relProperty]: id } });
      if (relPayloads) {
        const savedIds = await this.saveMany(relEntity, relPayloads);
        const throughBodies = savedIds.map((relId) => ({
          [references[0].source]: id,
          [references[1].source]: relId,
        }));
        await this.insertMany(throughEntity, throughBodies);
      }
      return;
    }

    if (cardinality === '1m') {
      if (relPayloads) {
        for (const it of relPayloads) {
          it[relProperty] = id;
        }
      }
      if (isUpdate) {
        await this.deleteMany(relEntity, { $filter: { [relProperty]: id } });
      }
      if (relPayloads) {
        await this.saveMany(relEntity, relPayloads);
      }
      return;
    }
  }

  getRepository<E>(entity: Type<E>): Repository<E> {
    return new BaseRepository(entity, this);
  }
}

function getIndependentRelations<E>(meta: EntityMeta<E>, payload: E) {
  return objectKeys(payload).filter((key) => {
    const relOpts = meta.relations[key];
    return relOpts && relOpts.cardinality !== 'm1';
  });
}
