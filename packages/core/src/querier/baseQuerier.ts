import {
  EntityMeta,
  Properties,
  Querier,
  Query,
  QueryCriteria,
  QueryOne,
  QueryPopulate,
  ReferenceOptions,
  RelationOptions,
  Repository,
  Type,
} from '../type';
import { getMeta } from '../entity/decorator';
import { cloneDeep } from '../util';
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
    const key = qo.$populate ? `${meta.name}.${meta.id.name}` : meta.id.name;
    return this.findOne(type, { ...qo, $filter: { [key]: id } });
  }

  abstract deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: any) {
    const meta = getMeta(entity);
    return this.deleteMany(entity, { [meta.id.name]: id });
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
      const relMeta = getMeta(relEntity);
      const relQuery = cloneDeep(populate[relKey] as Query<typeof relEntity>);
      const prop = relOpts.references[0].source;

      if (relOpts.cardinality === '1m') {
        if (relQuery.$project) {
          if (Array.isArray(relQuery.$project)) {
            if (!relQuery.$project.includes(prop)) {
              relQuery.$project.push(prop);
            }
          } else if (!relQuery.$project[prop]) {
            relQuery.$project[prop] = true;
          }
        }
        const ids = payload.map((it) => it[meta.id.property]);
        relQuery.$filter = { [prop]: { $in: ids } };
        const founds = await this.findMany(relEntity, relQuery);
        const foundsMap = founds.reduce((acc, it) => {
          const attr = it[prop];
          if (!acc[attr]) {
            acc[attr] = [];
          }
          acc[attr].push(it);
          return acc;
        }, {});
        for (const it of payload) {
          it[relKey] = foundsMap[it[meta.id.property]];
        }
      } else if (relOpts.cardinality === 'mm') {
        throw new TypeError('Not Implemented yet');
        // TODO
        // console.log(relKey, relQuery, relOpts.references, relOpts.mappedBy);
        // const throughEntity = relOpts.through();
        // const ids = payload.map((it) => it[meta.id.property]);
        // const targetEntity = (relMeta.properties[prop].reference as ReferenceOptions).entity();
        // const targetName = getMeta(targetEntity).name;
        // const throughData = await this.findMany(throughEntity, {
        //   $filter: { [prop]: { $in: ids } },
        //   $populate: {
        //     [targetName]: {
        //       ...relQuery,
        //       $required: true,
        //     },
        //   },
        // });
      }
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

  protected async saveMany<E>(entity: Type<E>, payload: E[]): Promise<void> {
    const meta = getMeta(entity);
    const news: E[] = [];
    const olds: E[] = [];

    for (const it of payload) {
      if (it[meta.id.property]) {
        olds.push(it);
      } else {
        news.push(it);
      }
    }

    await Promise.all([
      this.insertMany(entity, news),
      Promise.all(olds.map((it) => this.updateOneById(entity, it, it[meta.id.property]))),
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

    if (relPayloads) {
      for (const it of relPayloads) {
        it[relProperty] = id;
      }
    }

    if (cardinality === '1m') {
      if (isUpdate) {
        await this.deleteMany(relEntity, { $filter: { [relProperty]: id } });
      }
      if (relPayloads) {
        await this.saveMany(relEntity, relPayloads);
      }
      return;
    }

    if (cardinality === 'mm') {
      const throughEntity = through();
      await this.deleteMany(throughEntity, { $filter: { [relProperty]: id } });
      if (relPayloads) {
        const relIds = await this.insertMany(relEntity, relPayloads);
        const throughBodies = relIds.map((relId) => ({
          [references[0].source]: id,
          [references[1].source]: relId,
        }));
        await this.insertMany(throughEntity, throughBodies);
        return;
      }
    }
  }

  getRepository<E>(entity: Type<E>): Repository<E> {
    return new BaseRepository(entity, this);
  }
}

function getIndependentRelations<E>(meta: EntityMeta<E>, payload: E) {
  return Object.keys(payload).filter((prop) => {
    const relOpts = meta.relations[prop];
    return relOpts && relOpts.cardinality !== 'm1';
  });
}
