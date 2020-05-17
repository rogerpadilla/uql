import { defineRelation } from './storage';
import {
  RelationProperties,
  RelationOneToOneProperties,
  RelationOneToManyProperties,
  RelationManyToOneProperties,
  RelationManyToManyProperties,
} from './type';

function Relation<T>(args: RelationProperties<T>) {
  return (target: object, prop: string) => {
    const type = target.constructor as { new (): T };
    defineRelation(type, prop, args);
  };
}

export function OneToOne<T>(args?: RelationOneToOneProperties<T>) {
  return Relation({ cardinality: 'oneToOne', ...args });
}

export function ManyToOne<T>(args?: RelationManyToOneProperties<T>) {
  return Relation({ cardinality: 'manyToOne', ...args });
}

export function OneToMany<T>(args: RelationOneToManyProperties<T>) {
  return Relation({ cardinality: 'oneToMany', ...args });
}

export function ManyToMany<T>(args: RelationManyToManyProperties<T>) {
  return Relation({ cardinality: 'manyToMany', ...args });
}
