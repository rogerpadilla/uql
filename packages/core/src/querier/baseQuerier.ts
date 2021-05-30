import { EntityMeta, Querier, Query, QueryFilter, QueryOne, QueryPopulate, Type } from '../type';
import { getMeta } from '../entity/decorator';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class BaseQuerier implements Querier {
  abstract insertMany<E>(entity: Type<E>, body: E[]): Promise<any[]>;

  async insertOne<E>(entity: Type<E>, body: E) {
    const [id] = await this.insertMany(entity, [body]);
    await this.insertRelations(entity, id, body);
    return id;
  }

  abstract updateMany<E>(entity: Type<E>, filter: QueryFilter<E>, body: E): Promise<number>;

  async updateOneById<E>(entity: Type<E>, id: any, body: E) {
    const meta = getMeta(entity);
    const changes = await this.updateMany(entity, { [meta.id.property]: id }, body);
    await this.updateRelations(entity, id, body);
    return changes;
  }

  abstract findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  async findOne<E>(entity: Type<E>, qm: Query<E>) {
    qm.limit = 1;
    const rows = await this.findMany(entity, qm);
    return rows[0];
  }

  findOneById<E>(type: Type<E>, id: any, qo: QueryOne<E> = {}) {
    const meta = getMeta(type);
    const key = qo.populate ? `${meta.name}.${meta.id.name}` : meta.id.name;
    return this.findOne(type, { ...qo, filter: { [key]: id } });
  }

  abstract deleteMany<E>(entity: Type<E>, filter: QueryFilter<E>): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: any) {
    const meta = getMeta(entity);
    return this.deleteMany(entity, { [meta.id.name]: id });
  }

  abstract count<E>(entity: Type<E>, filter?: QueryFilter<E>): Promise<number>;

  abstract readonly hasOpenTransaction: boolean;

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  abstract release(): Promise<void>;

  protected async populateToManyRelations<E>(entity: Type<E>, bodies: E[], populate: QueryPopulate<E>) {
    const meta = getMeta(entity);

    for (const relKey in populate) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${relKey}' is not annotated as a relation`);
      }
      const relEntity = relOpts.entity();
      const relQuery = populate[relKey] as Query<typeof relEntity>;
      if (relOpts.cardinality === '1m') {
        const ids = bodies.map((body) => body[meta.id.property]);
        const prop = relOpts.references[0].source;
        relQuery.filter = { [prop]: { $in: ids } };
        const founds = await this.findMany(relEntity, relQuery);
        const foundsMap = founds.reduce((acc, it) => {
          const attr = it[prop];
          if (!acc[attr]) {
            acc[attr] = [];
          }
          acc[attr].push(it);
          return acc;
        }, {});
        for (const body of bodies) {
          body[relKey] = foundsMap[body[meta.id.property]];
        }
      } else if (relOpts.cardinality === 'mm') {
        // TODO mm cardinality
        throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
      }
    }
  }

  protected async insertRelations<E>(entity: Type<E>, id: any, body: E) {
    const meta = getMeta(entity);

    const insertProms = getIndependentRelations(meta, body).map(async (relKey) => {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      if (relOpts.cardinality === '11') {
        const prop = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
        const relBody: E = { ...body[relKey], [prop]: id };
        return this.insertOne(relEntity, relBody);
      }
      if (relOpts.cardinality === '1m') {
        const prop = relOpts.references[0].source;
        const relBodies: E[] = body[relKey].map((it: E) => {
          it[prop] = id;
          return it;
        });
        return this.insertMany(relEntity, relBodies);
      }
      if (relOpts.cardinality === 'mm') {
        const relIds = await this.insertMany(relEntity, body[relKey]);
        const throughRecords = relIds.map((relId) => ({
          [relOpts.references[0].source]: id,
          [relOpts.references[1].source]: relId,
        }));
        return this.insertMany(relOpts.through(), throughRecords);
      }
    });

    await Promise.all<any>(insertProms);
  }

  protected async updateRelations<E>(entity: Type<E>, id: any, body: E) {
    const meta = getMeta(entity);

    const deletePromises = getIndependentRelations(meta, body).map(async (relKey) => {
      const relOpts = meta.relations[relKey];
      const relEntity = relOpts.entity();
      if (relOpts.cardinality === '11') {
        const relBody: E = body[relKey];
        const prop = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
        if (relBody === null) {
          return this.deleteMany(relEntity, { [prop]: id });
        }
        return this.updateMany(relEntity, { [prop]: id }, relBody);
      }
      if (relOpts.cardinality === '1m') {
        const relBody: E[] = body[relKey];
        const prop = relOpts.references[0].source;
        await this.deleteMany(relEntity, { [prop]: id });
        if (relBody !== null) {
          for (const it of relBody) {
            it[prop] = id;
          }
          return this.insertMany(relEntity, relBody);
        }
      }
      if (relOpts.cardinality === 'mm') {
        // TODO mm cardinality
        throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
      }
    });

    await Promise.all(deletePromises);
  }
}

function getIndependentRelations<E>(meta: EntityMeta<E>, body: E) {
  return Object.keys(body).filter((prop) => {
    const relOpts = meta.relations[prop];
    return relOpts && relOpts.cardinality !== 'm1';
  });
}
