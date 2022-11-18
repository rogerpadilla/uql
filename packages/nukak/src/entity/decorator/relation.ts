import {
  RelationOptions,
  RelationOneToOneOptions,
  RelationOneToManyOptions,
  RelationManyToOneOptions,
  RelationManyToManyOptions,
  Type,
} from '../../type';
import { defineRelation } from './definition.js';

function Relation<E>(opts: RelationOptions<E>) {
  return (target: object, key: string) => {
    const entity = target.constructor as Type<E>;
    defineRelation(entity, key, opts);
  };
}

type RelationReturn = ReturnType<typeof Relation>;

export function OneToOne<E>(opts?: RelationOneToOneOptions<E>): RelationReturn {
  return Relation({ cardinality: '11', ...opts });
}

export function ManyToOne<E>(opts?: RelationManyToOneOptions<E>): RelationReturn {
  return Relation({ cardinality: 'm1', ...opts });
}

export function OneToMany<E>(opts: RelationOneToManyOptions<E>): RelationReturn {
  return Relation({ cardinality: '1m', ...opts });
}

export function ManyToMany<E>(opts: RelationManyToManyOptions<E>): RelationReturn {
  return Relation({ cardinality: 'mm', ...opts });
}
