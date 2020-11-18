import { getEntityMeta } from '../entity/decorator';
import { Query, QueryFilter, QueryOne, EntityMeta, Repository } from '../type';
import { Querier } from '../querier';
import { Transactional, InjectQuerier } from '../querier/decorator';

export class GenericRepository<T, ID = any> implements Repository<T, ID> {
  readonly meta: EntityMeta<T>;

  constructor(type: { new (): T }) {
    this.meta = getEntityMeta(type);
  }

  @Transactional({ propagation: 'required' })
  insertOne(body: T, @InjectQuerier() querier?: Querier<ID>) {
    return querier.insertOne(this.meta.type, body);
  }

  @Transactional({ propagation: 'required' })
  updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier<ID>) {
    return querier.updateOneById(this.meta.type, id, body);
  }

  @Transactional({ propagation: 'required' })
  async saveOne(body: T, @InjectQuerier() querier?: Querier<ID>) {
    const id = body[this.meta.id.property];
    if (id) {
      await this.updateOneById(id, body, querier);
      return id;
    }
    return this.insertOne(body, querier);
  }

  @Transactional()
  find(qm: Query<T>, @InjectQuerier() querier?: Querier<ID>) {
    return querier.find(this.meta.type, qm);
  }

  @Transactional()
  findOne(qm: Query<T>, @InjectQuerier() querier?: Querier<ID>) {
    return querier.findOne(this.meta.type, qm);
  }

  @Transactional()
  findOneById(id: ID, qo: QueryOne<T> = {}, @InjectQuerier() querier?: Querier<ID>) {
    return querier.findOneById(this.meta.type, id, qo);
  }

  @Transactional({ propagation: 'required' })
  remove(filter: QueryFilter<T>, @InjectQuerier() querier?: Querier<ID>) {
    return querier.remove(this.meta.type, filter);
  }

  @Transactional({ propagation: 'required' })
  removeOneById(id: ID, @InjectQuerier() querier?: Querier<ID>) {
    return querier.removeOneById(this.meta.type, id);
  }

  @Transactional()
  count(filter: QueryFilter<T>, @InjectQuerier() querier?: Querier<ID>) {
    return querier.count(this.meta.type, filter);
  }
}
