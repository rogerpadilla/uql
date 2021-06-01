import {
  RelationOptions,
  RelationOneToOneOptions,
  RelationOneToManyOptions,
  RelationManyToOneOptions,
  RelationManyToManyOptions,
  Type,
} from '../../type';
import { defineRelation } from './definition';

function Relation<E>(opts: RelationOptions<E>) {
  return (target: object, prop: string) => {
    const entity = target.constructor as Type<E>;
    defineRelation(entity, prop, opts);
  };
}

export function OneToOne<E>(opts?: RelationOneToOneOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: '11', ...opts });
}

export function ManyToOne<E>(opts?: RelationManyToOneOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: 'm1', ...opts });
}

export function OneToMany<E>(opts: RelationOneToManyOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: '1m', ...opts });
}

export function ManyToMany<E>(opts: RelationManyToManyOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: 'mm', ...opts });
}
