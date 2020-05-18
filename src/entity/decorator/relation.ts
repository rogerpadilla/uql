import { defineRelation } from './storage';
import {
  RelationOptions,
  RelationOneToOneOptions,
  RelationOneToManyOptions,
  RelationManyToOneOptions,
  RelationManyToManyOptions,
} from './type';

function Relation<T>(opts: RelationOptions<T>) {
  return (target: object, prop: string) => {
    const type = target.constructor as { new (): T };
    defineRelation(type, prop, opts);
  };
}

export function OneToOne<T>(opts: RelationOneToOneOptions<T>) {
  return Relation({ cardinality: 'oneToOne', ...opts });
}

export function ManyToOne<T>(opts?: RelationManyToOneOptions<T>) {
  return Relation({ cardinality: 'manyToOne', ...opts });
}

export function OneToMany<T>(opts: RelationOneToManyOptions<T>) {
  return Relation({ cardinality: 'oneToMany', ...opts });
}

export function ManyToMany<T>(opts: RelationManyToManyOptions<T>) {
  return Relation({ cardinality: 'manyToMany', ...opts });
}
