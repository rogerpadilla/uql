import { Query, QueryFilter, QueryOneFilter, QueryOne } from '../type';
import { getEntityMeta } from '../entity';
import { Querier, Transactional, InjectQuerier } from '../datasource';
import { GenericRepository } from './decorator';
import { ServerRepository } from './type';

@GenericRepository()
export class GenericServerRepository<T, ID> implements ServerRepository<T, ID> {
  protected readonly idName: string;

  constructor(readonly type: { new (): T }) {
    const meta = getEntityMeta(this.type);
    this.idName = meta.id;
  }

  @Transactional({ propagation: 'required' })
  insertOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    return querier.insertOne(this.type, body);
  }

  @Transactional({ propagation: 'required' })
  async updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    const affectedRows = await querier.updateOne(this.type, { [this.idName]: id }, body);
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
    return id;
  }

  @Transactional({ propagation: 'required' })
  saveOne(body: T, @InjectQuerier() querier?: Querier): Promise<ID> {
    const id: ID = body[this.idName];
    if (id) {
      return this.updateOneById(id, body, querier);
    }
    return this.insertOne(body, querier);
  }

  @Transactional()
  findOneById(id: ID, qm: QueryOne<T> = {}, @InjectQuerier() querier?: Querier): Promise<T> {
    (qm as QueryOneFilter<T>).filter = { [this.idName]: id };
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
  async removeOneById(id: ID, @InjectQuerier() querier?: Querier): Promise<ID> {
    const affectedRows = await querier.removeOne(this.type, { [this.idName]: id });
    if (!affectedRows) {
      throw new Error('Unaffected record');
    }
    return id;
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
