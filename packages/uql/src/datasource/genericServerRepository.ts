import { getEntityMeta } from 'uql/decorator';
import { Query, QueryFilter, QueryOne, EntityMeta, ServerRepository, Querier } from 'uql/type';
import { Transactional, InjectQuerier } from './decorator';

export class GenericServerRepository<T, ID = any> implements ServerRepository<T, ID> {
  readonly meta: EntityMeta<T>;

  constructor(type: { new (): T }) {
    this.meta = getEntityMeta(type);
  }

  @Transactional({ propagation: 'required' })
  async insertOne(body: T, @InjectQuerier() querier?: Querier<ID>) {
    const id = await querier.insertOne(this.meta.type, body);
    await this.insertRelations({ ...body, [this.meta.id.property]: id }, querier);
    return id;
  }

  @Transactional({ propagation: 'required' })
  async updateOneById(id: ID, body: T, @InjectQuerier() querier?: Querier<ID>) {
    const affectedRows = await querier.update(this.meta.type, { [this.meta.id.property]: id }, body);
    await this.updateRelations({ ...body, [this.meta.id.property]: id }, querier);
    return affectedRows;
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

  protected async insertRelations(body: T, querier: Querier<ID>) {
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
      if (relOpts.cardinality === 'manyToMany') {
        throw new TypeError(`unsupported update cardinality ${relOpts.cardinality}`);
      }
    });

    await Promise.all<any>(insertProms);
  }

  protected async updateRelations(body: T, querier: Querier<ID>) {
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
      }
      if (relOpts.cardinality === 'oneToMany') {
        const relBody: T[] = body[prop];
        await querier.remove(relType, { [relOpts.mappedBy]: id });
        if (relBody !== null) {
          relBody.forEach((it: T) => {
            it[relOpts.mappedBy] = id;
          });
          return querier.insert(relType, relBody);
        }
      }
      if (relOpts.cardinality === 'manyToMany') {
        throw new TypeError(`unsupported update cardinality ${relOpts.cardinality}`);
      }
    });

    await Promise.all(removeProms);
  }

  protected filterIndependentRelations(body: T) {
    return Object.keys(body).filter((prop) => {
      const relOpts = this.meta.relations[prop];
      return relOpts && relOpts.cardinality !== 'manyToOne';
    });
  }
}
