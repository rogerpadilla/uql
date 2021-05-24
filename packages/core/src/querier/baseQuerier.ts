import { EntityMeta, Querier, Query, QueryFilter, QueryOne, QueryOptions, QueryPopulate, Type } from '../type';
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
    const affectedRows = await this.updateMany(entity, { [meta.id.property]: id }, body);
    await this.updateRelations(entity, id, body);
    return affectedRows;
  }

  abstract findMany<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): Promise<E[]>;

  async findOne<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions) {
    qm.limit = 1;
    const rows = await this.findMany(entity, qm, opts);
    return rows[0];
  }

  findOneById<E>(type: Type<E>, id: any, qo: QueryOne<E> = {}, opts?: QueryOptions) {
    const meta = getMeta(type);
    const key = qo.populate ? `${meta.name}.${meta.id.name}` : meta.id.name;
    return this.findOne(type, { ...qo, filter: { [key]: id } }, opts);
  }

  abstract removeMany<E>(entity: Type<E>, filter: QueryFilter<E>): Promise<number>;

  removeOneById<E>(entity: Type<E>, id: any) {
    const meta = getMeta(entity);
    return this.removeMany(entity, { [meta.id.name]: id });
  }

  abstract count<E>(entity: Type<E>, filter?: QueryFilter<E>): Promise<number>;

  abstract query(query: string): Promise<any>;

  abstract readonly hasOpenTransaction: boolean;

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  abstract release(): Promise<void>;

  protected async populateToManyRelations<E>(entity: Type<E>, bodies: E[], populate: QueryPopulate<E>) {
    const meta = getMeta(entity);

    for (const popKey in populate) {
      const relOpts = meta.relations[popKey];
      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${popKey}' is not annotated as a relation`);
      }
      const popVal = populate[popKey];
      const relEntity = relOpts.entity();
      const relQuery = popVal as Query<any>;
      if (relOpts.cardinality === '1m') {
        const ids = bodies.map((body) => body[meta.id.property]);
        const mappedByKey = relOpts.mappedBy as string;
        relQuery.filter = { [mappedByKey]: { $in: ids } };
        const founds = await this.findMany(relEntity, relQuery);
        const foundsMap = founds.reduce((acc, it) => {
          const attr = it[mappedByKey];
          if (!acc[attr]) {
            acc[attr] = [];
          }
          acc[attr].push(it);
          return acc;
        }, {});
        for (const body of bodies) {
          body[popKey] = foundsMap[body[meta.id.property]];
        }
      } else if (relOpts.cardinality === 'mm') {
        // TODO mm cardinality
        throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
      }
    }
  }

  protected async insertRelations<E>(entity: Type<E>, id: any, body: E) {
    const meta = getMeta(entity);

    const insertProms = filterIndependentRelations(meta, body).map((prop) => {
      const relOpts = meta.relations[prop];
      const relEntity = relOpts.entity();
      const mappedByKey = relOpts.mappedBy as string;
      if (relOpts.cardinality === '11') {
        const target = relOpts.references[0].target;
        const relBody: E = { ...body[prop], [target]: id };
        return this.insertOne(relEntity, relBody);
      }
      if (relOpts.cardinality === '1m') {
        const relBodies: E[] = body[prop].map((it: E) => {
          it[mappedByKey] = id;
          return it;
        });
        return this.insertMany(relEntity, relBodies);
      }
      if (relOpts.cardinality === 'mm') {
        // TODO mm cardinality
        throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
      }
    });

    await Promise.all<any>(insertProms);
  }

  protected async updateRelations<E>(entity: Type<E>, id: any, body: E) {
    const meta = getMeta(entity);

    const removeProms = filterIndependentRelations(meta, body).map(async (prop) => {
      const relOpts = meta.relations[prop];
      const relEntity = relOpts.entity();
      const mappedByKey = relOpts.mappedBy as string;
      if (relOpts.cardinality === '11') {
        const relBody: E = body[prop];
        if (relBody === null) {
          return this.removeMany(relEntity, { [mappedByKey]: id });
        }
        return this.updateMany(relEntity, { [mappedByKey]: id }, relBody);
      }
      if (relOpts.cardinality === '1m') {
        const relBody: E[] = body[prop];
        await this.removeMany(relEntity, { [mappedByKey]: id });
        if (relBody !== null) {
          for (const it of relBody) {
            it[mappedByKey] = id;
          }
          return this.insertMany(relEntity, relBody);
        }
      }
      if (relOpts.cardinality === 'mm') {
        // TODO mm cardinality
        throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
      }
    });

    await Promise.all(removeProms);
  }
}

function filterIndependentRelations<E>(meta: EntityMeta<E>, body: E) {
  return Object.keys(body).filter((prop) => {
    const relOpts = meta.relations[prop];
    return relOpts && relOpts.cardinality !== 'm1';
  });
}
