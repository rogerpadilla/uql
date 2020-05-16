import { Query, QueryFilter, QueryOneFilter, QueryOne } from '../type';
import { getEntityMeta } from '../entity';
import { Querier, Transactional, InjectQuerier } from '../datasource';
import { ServerRepository } from './type';

export class GenericServerRepository<T, ID> implements ServerRepository<T, ID> {
  protected readonly typeMeta = getEntityMeta(this.type);

  constructor(readonly type: { new (): T }) {}

  @Transactional({ propagation: 'required' })
  insertOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    return querier.insertOne(this.type, body);
  }

  @Transactional({ propagation: 'required' })
  async updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier): Promise<void> {
    const affectedRows = await querier.updateOne(this.type, { [this.typeMeta.id]: id }, body);
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
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
}
