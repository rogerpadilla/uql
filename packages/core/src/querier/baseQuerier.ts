import { EntityMeta, Querier, Query, QueryFilter, QueryOne, QueryPopulate, RelationOptions, Type } from '../type';
import { getMeta } from '../entity/decorator';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class BaseQuerier implements Querier {
  abstract insertMany<E>(entity: Type<E>, body: E[]): Promise<any[]>;

  async insertOne<E>(entity: Type<E>, body: E) {
    const [id] = await this.insertMany(entity, [body]);
    return id;
  }

  abstract updateMany<E>(entity: Type<E>, filter: QueryFilter<E>, body: E): Promise<number>;

  async updateOneById<E>(entity: Type<E>, id: any, body: E) {
    const meta = getMeta(entity);
    const changes = await this.updateMany(entity, { [meta.id.property]: id }, body);
    await this.updateRelations(meta, id, body);
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

  protected async insertRelations<E>(meta: EntityMeta<E>, id: any, body: E) {
    const relKeys = getIndependentRelations(meta, body);

    await Promise.all(
      relKeys.map(async (relKey) => {
        const relOpts = meta.relations[relKey];
        this.insertRelation(id, body[relKey], relOpts);
      })
    );
  }

  protected async insertRelation<E>(id: any, relBody: E | E[], relOpts: RelationOptions<E>) {
    const relEntity = relOpts.entity();
    if (relOpts.cardinality === '11') {
      const prop = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
      return this.insertOne(relEntity, { ...relBody, [prop]: id });
    }
    if (relOpts.cardinality === '1m') {
      const prop = relOpts.references[0].source;
      const relBodies: E[] = (relBody as E[]).map((it: E) => {
        it[prop] = id;
        return it;
      });
      return this.insertMany(relEntity, relBodies);
    }
    if (relOpts.cardinality === 'mm') {
      const relIds = await this.insertMany(relEntity, relBody as E[]);
      const throughBodies = relIds.map((relId) => ({
        [relOpts.references[0].source]: id,
        [relOpts.references[1].source]: relId,
      }));
      return this.insertMany(relOpts.through(), throughBodies);
    }
  }

  protected async updateRelations<E>(meta: EntityMeta<E>, id: any, body: E) {
    const relKeys = getIndependentRelations(meta, body);
    if (relKeys.length) {
      await Promise.all(relKeys.map((relKey) => this.updateRelation(id, body[relKey], meta.relations[relKey])));
    }
  }

  protected async updateRelation<E>(id: any, relBody: E | E[], relOpts: RelationOptions<E>): Promise<void> {
    const relEntity = relOpts.entity();
    if (relOpts.cardinality === '11') {
      const prop = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
      if (relBody === null) {
        await this.deleteMany(relEntity, { [prop]: id });
        return;
      }
      await this.updateMany(relEntity, { [prop]: id }, relBody);
      return;
    }
    if (relOpts.cardinality === '1m') {
      const prop = relOpts.references[0].source;
      await this.deleteMany(relEntity, { [prop]: id });
      if (Array.isArray(relBody)) {
        for (const it of relBody) {
          it[prop] = id;
        }
        await this.insertMany(relEntity, relBody);
        return;
      }
    }
    if (relOpts.cardinality === 'mm') {
      // TODO mm cardinality
      throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
    }
  }
}

function getIndependentRelations<E>(meta: EntityMeta<E>, body: E) {
  return Object.keys(body).filter((prop) => {
    const relOpts = meta.relations[prop];
    return relOpts && relOpts.cardinality !== 'm1';
  });
}
