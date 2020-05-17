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
  async insertOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    const id = await querier.insertOne(this.meta.type, body);
    await this.insertRelations({ ...body, [this.meta.id]: id }, querier);
    return id;
  }

  @Transactional({ propagation: 'required' })
  async updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier): Promise<void> {
    const affectedRows = await querier.updateOne(this.meta.type, { [this.meta.id]: id }, body);
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
    await this.updateRelations({ ...body, [this.meta.id]: id }, querier);
  }

  @Transactional({ propagation: 'required' })
  async saveOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    const id: ID = body[this.meta.id];
    if (id) {
      await this.updateOneById(id, body, querier);
      return id;
    }
    return this.insertOne(body, querier);
  }

  @Transactional()
  findOneById(id: ID, qm: QueryOne<T> = {}, @InjectQuerier() querier?: Querier): Promise<T> {
    (qm as QueryOneFilter<T>).filter = { [this.meta.id]: id };
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
    const affectedRows = await querier.removeOne(this.meta.type, { [this.meta.id]: id });
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
    const id = body[this.meta.id];

    const insertProms = this.filterIndependentRelations(body).map((prop) => {
      const rel = this.meta.columns[prop].relation;
      const relType = rel.type();
      const relBody = body[prop];
      if (rel.cardinality === 'oneToOne') {
        return querier.insertOne(relType, relBody);
      }
      if (rel.cardinality === 'oneToMany') {
        relBody.forEach((it: T) => {
          it[rel.mappedBy] = id;
        });
        return querier.insert(relType, relBody);
      }
      throw new Error('TODO unsupported cardinality ' + rel.cardinality);
    });

    await Promise.all(insertProms);
  }

  protected async updateRelations(body: T, querier: Querier): Promise<void> {
    const id = body[this.meta.id];

    const removeProms = this.filterIndependentRelations(body).map(async (prop) => {
      const rel = this.meta.columns[prop].relation;
      const relType = rel.type();
      const relBody = body[prop];
      if (rel.cardinality === 'oneToOne') {
        if (relBody === null) {
          return querier.removeOne(relType, { [rel.mappedBy]: id });
        }
        return querier.updateOne(relType, { [rel.mappedBy]: id }, relBody);
      } else if (rel.cardinality === 'oneToMany') {
        await querier.remove(relType, { [rel.mappedBy]: id });
        if (relBody !== null) {
          relBody.forEach((it: T) => {
            it[rel.mappedBy] = id;
          });
          return querier.insert(relType, relBody);
        }
      } else {
        throw new Error('TODO unsupported cardinality ' + rel.cardinality);
      }
    });

    await Promise.all(removeProms);
  }

  protected filterIndependentRelations(body: T) {
    return Object.keys(body).filter((prop) => {
      const colProps = this.meta.columns[prop];
      return colProps.relation && colProps.relation.cardinality !== 'manyToOne';
    });
  }
}
