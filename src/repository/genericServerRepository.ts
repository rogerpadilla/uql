import { Query, QueryFilter, QueryOneFilter, QueryOne } from '../type';
import { getEntityMeta } from '../entity';
import { Querier, Transactional, InjectQuerier } from '../datasource';
import { ServerRepository } from './type';

export class GenericServerRepository<T, ID> implements ServerRepository<T, ID> {
  protected readonly typeMeta = getEntityMeta(this.type);

  constructor(readonly type: { new (): T }) {}

  @Transactional({ propagation: 'required' })
  async insertOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    const id = querier.insertOne(this.type, body);
    await this.insertRelations({ ...body, [this.typeMeta.id]: id }, querier);
    return id;
  }

  @Transactional({ propagation: 'required' })
  async updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier): Promise<void> {
    const affectedRows = await querier.updateOne(this.type, { [this.typeMeta.id]: id }, body);
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
    await this.updateRelations({ ...body, [this.typeMeta.id]: id }, querier);
  }

  @Transactional({ propagation: 'required' })
  async saveOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    const id: ID = body[this.typeMeta.id];
    if (id) {
      await this.updateOneById(id, body, querier);
      return id;
    }
    return this.insertOne(body, querier);
  }

  @Transactional()
  findOneById(id: ID, qm: QueryOne<T> = {}, @InjectQuerier() querier?: Querier): Promise<T> {
    (qm as QueryOneFilter<T>).filter = { [this.typeMeta.id]: id };
    return querier.findOne(this.type, qm);
  }

  @Transactional()
  findOne(qm: QueryOneFilter<T>, @InjectQuerier() querier?: Querier): Promise<T> {
    return querier.findOne(this.type, qm);
  }

  @Transactional()
  find(qm: Query<T>, @InjectQuerier() querier?: Querier): Promise<T[]> {
    return querier.find(this.type, qm);
  }

  @Transactional({ propagation: 'required' })
  async removeOneById(id: ID, @InjectQuerier() querier?: Querier): Promise<void> {
    const affectedRows = await querier.removeOne(this.type, { [this.typeMeta.id]: id });
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
  }

  @Transactional({ propagation: 'required' })
  remove(filter: QueryFilter<T>, @InjectQuerier() querier?: Querier): Promise<number> {
    return querier.remove(this.type, filter);
  }

  @Transactional()
  count(filter: QueryFilter<T>, @InjectQuerier() querier?: Querier): Promise<number> {
    return querier.count(this.type, filter);
  }

  // TODO 'manyToMany' support
  @Transactional({ propagation: 'mandatory' })
  protected async insertRelations(body: T, @InjectQuerier() querier?: Querier): Promise<void> {
    const insertProms = this.filterRelationsWithOwnData(body).map((prop) => {
      const rel = this.typeMeta.columns[prop].relation;
      const relType = rel.type();
      const relBody = Array.isArray(body[prop]) ? body[prop] : [body[prop]];
      relBody.forEach((it: T) => {
        it[rel.mappedBy] = body[this.typeMeta.id];
      });
      return querier.insert(relType, relBody);
    });
    await Promise.all(insertProms);
  }

  // TODO 'manyToMany' support
  @Transactional({ propagation: 'mandatory' })
  protected async updateRelations(body: T, @InjectQuerier() querier?: Querier): Promise<void> {
    const removeProms = this.filterRelationsWithOwnData(body).map((prop) => {
      const rel = this.typeMeta.columns[prop].relation;
      const relType = rel.type();
      return querier.remove(relType, { [rel.mappedBy]: body[this.typeMeta.id] });
    });
    await Promise.all(removeProms);
    await this.insertRelations(body, querier);
  }

  protected filterRelationsWithOwnData(body: T) {
    return Object.keys(body).filter((prop) => {
      const colProps = this.typeMeta.columns[prop];
      return colProps.relation && colProps.relation.cardinality !== 'manyToOne';
    });
  }
}
