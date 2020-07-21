import { Query, QueryFilter, QueryOneFilter, QueryOne } from '../type';
import { getEntityMeta, EntityMeta } from '../entity';
import { Querier, Transactional, InjectQuerier } from '../datasource';
import { ServerRepository } from './type';

export class GenericServerRepository<T, ID> implements ServerRepository<T, ID> {
  readonly meta: EntityMeta<T>;

  constructor(type: { new (): T }) {
    this.meta = getEntityMeta(type);
  }

  @Transactional({ propagation: 'required' })
  async insertOne(body: T, @InjectQuerier() querier?: Querier<ID>): Promise<ID> {
    const id = await querier.insertOne(this.meta.type, body);
    await this.insertRelations({ ...body, [this.meta.id.property]: id }, querier);
    return id;
  }

  @Transactional({ propagation: 'required' })
  async updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier): Promise<void> {
    const affectedRows = await querier.update(this.meta.type, { [this.meta.id.property]: id }, body);
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
    await this.updateRelations({ ...body, [this.meta.id.property]: id }, querier);
  }

  @Transactional({ propagation: 'required' })
  async saveOne(body: T, @InjectQuerier() querier?: Querier<ID>): Promise<ID> {
    const id = body[this.meta.id.property] as ID;
    if (id) {
      await this.updateOneById(id, body, querier);
      return id;
    }
    return this.insertOne(body, querier);
  }

  @Transactional()
  findOneById(id: ID, qm: QueryOne<T> = {}, @InjectQuerier() querier?: Querier): Promise<T> {
    (qm as QueryOneFilter<T>).filter = { [this.meta.id.property]: id };
    return querier.findOne(this.meta.type, qm);
  }

  @Transactional()
  findOne(qm: QueryOneFilter<T>, @InjectQuerier() querier?: Querier): Promise<T> {
    return querier.findOne(this.meta.type, qm);
  }

  @Transactional()
  find(qm: Query<T>, @InjectQuerier() querier?: Querier): Promise<T[]> {
    return querier.find(this.meta.type, qm);
  }

  @Transactional({ propagation: 'required' })
  async removeOneById(id: ID, @InjectQuerier() querier?: Querier): Promise<void> {
    const affectedRows = await querier.remove(this.meta.type, { [this.meta.id.property]: id });
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
  }

  @Transactional({ propagation: 'required' })
  remove(filter: QueryFilter<T>, @InjectQuerier() querier?: Querier): Promise<number> {
    return querier.remove(this.meta.type, filter);
  }

  @Transactional()
  count(filter: QueryFilter<T>, @InjectQuerier() querier?: Querier): Promise<number> {
    return querier.count(this.meta.type, filter);
  }

  protected async insertRelations(body: T, querier: Querier): Promise<void> {
    const id = body[this.meta.id.property];

    const insertProms = this.filterIndependentRelations(body).map((prop) => {
      const relOpts = this.meta.relations[prop];
      const relType = relOpts.type();
      if (relOpts.cardinality === 'oneToOne') {
        const relBody: T = body[prop];
        return querier.insertOne(relType, relBody);
      }
      if (relOpts.cardinality === 'oneToMany') {
        const relBody: T[] = body[prop];
        relBody.forEach((it: T) => {
          it[relOpts.mappedBy] = id;
        });
        return querier.insert(relType, relBody);
      }
      throw new Error('TODO unsupported cardinality ' + relOpts.cardinality);
    });

    await Promise.all(insertProms);
  }

  protected async updateRelations(body: T, querier: Querier): Promise<void> {
    const id = body[this.meta.id.property];

    const removeProms = this.filterIndependentRelations(body).map(async (prop) => {
      const relOpts = this.meta.relations[prop];
      const relType = relOpts.type();
      if (relOpts.cardinality === 'oneToOne') {
        const relBody: T = body[prop];
        if (relBody === null) {
          return querier.remove(relType, { [relOpts.mappedBy]: id });
        }
        return querier.update(relType, { [relOpts.mappedBy]: id }, relBody);
      } else if (relOpts.cardinality === 'oneToMany') {
        const relBody: T[] = body[prop];
        await querier.remove(relType, { [relOpts.mappedBy]: id });
        if (relBody !== null) {
          relBody.forEach((it: T) => {
            it[relOpts.mappedBy] = id;
          });
          return querier.insert(relType, relBody);
        }
      } else {
        throw new Error('TODO unsupported cardinality ' + relOpts.cardinality);
      }
    });

    await Promise.all(removeProms);
  }

  protected filterIndependentRelations(body: T): string[] {
    return Object.keys(body).filter((prop) => {
      const relOpts = this.meta.relations[prop];
      return relOpts && relOpts.cardinality !== 'manyToOne';
    });
  }
}
