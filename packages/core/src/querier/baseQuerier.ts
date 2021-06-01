import {
  EntityMeta,
  Properties,
  Querier,
  Query,
  QueryCriteria,
  QueryFilter,
  QueryOne,
  QueryPopulate,
  RelationOptions,
  Type,
} from '../type';
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

  abstract updateMany<E>(entity: Type<E>, body: E, qm: QueryCriteria<E>): Promise<number>;

  updateOneById<E>(entity: Type<E>, body: E, id: any) {
    const meta = getMeta(entity);
    return this.updateMany(entity, body, { $filter: { [meta.id.property]: id } });
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
        for (const body of bodies) {
          body[relKey] = foundsMap[body[meta.id.property]];
        }
      } else if (relOpts.cardinality === 'mm') {
        // TODO mm cardinality
        throw new TypeError(`unsupported cardinality ${relOpts.cardinality}`);
      }
    }
  }

  protected async insertRelations<E>(entity: Type<E>, bodies: E[]) {
    const meta = getMeta(entity);
    await Promise.all(
      bodies.map((body) => {
        const relKeys = getIndependentRelations(meta, body);
        if (!relKeys.length) {
          return;
        }
        return Promise.all(
          relKeys.map((relKey) => this.saveRelation(body[meta.id.property], body[relKey], meta.relations[relKey]))
        );
      })
    );
  }

  protected async updateRelations<E>(entity: Type<E>, body: E, criteria: QueryCriteria<E>) {
    const meta = getMeta(entity);

    const relKeys = getIndependentRelations(meta, body);
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
        Promise.all(relKeys.map((relKey) => this.saveRelation(id, body[relKey], meta.relations[relKey], true)))
      )
    );
  }

  protected async saveMany<E>(entity: Type<E>, bodies: E[]): Promise<void> {
    const meta = getMeta(entity);

    const news: E[] = [];
    const olds: E[] = [];

    for (const it of bodies) {
      if (it[meta.id.property]) {
        olds.push(it);
      } else {
        news.push(it);
      }
    }

    await Promise.all([
      this.insertMany(entity, news),
      Promise.all(olds.map((old) => this.updateOneById(entity, old, old[meta.id.property]))),
    ]);
  }

  protected async saveRelation<E>(
    id: any,
    relBody: E | E[],
    relOpts: RelationOptions<E>,
    isUpdate?: boolean
  ): Promise<void> {
    const relEntity = relOpts.entity();

    if (relOpts.cardinality === '11') {
      const prop = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
      if (relBody === null) {
        await this.deleteMany(relEntity, { $filter: { [prop]: id } });
        return;
      }
      await this.saveMany(relEntity, [{ ...(relBody as E), [prop]: id }]);
      return;
    }

    const relBodies = relBody as E[];
    const prop = relOpts.references[0].source;

    if (relBodies) {
      for (const it of relBodies) {
        it[prop] = id;
      }
    }

    if (relOpts.cardinality === '1m') {
      if (isUpdate) {
        await this.deleteMany(relEntity, { $filter: { [prop]: id } });
      }
      if (relBodies) {
        this.saveMany(relEntity, relBodies);
      }
      return;
    }

    if (relOpts.cardinality === 'mm') {
      if (relBodies) {
        // TODO
        const relIds = await this.insertMany(relEntity, relBodies);
        const throughBodies = relIds.map((relId) => ({
          [relOpts.references[0].source]: id,
          [relOpts.references[1].source]: relId,
        }));
        await this.insertMany(relOpts.through(), throughBodies);
      } else {
        // TODO
      }
    }
  }
}

function getIndependentRelations<E>(meta: EntityMeta<E>, body: E) {
  return Object.keys(body).filter((prop) => {
    const relOpts = meta.relations[prop];
    return relOpts && relOpts.cardinality !== 'm1';
  });
}
