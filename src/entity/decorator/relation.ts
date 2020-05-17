import { defineRelation } from './storage';
import { RelationProperties, RelationToOneProperties, RelationToManyProperties } from './type';

function Relation<T>(args: RelationProperties<T>) {
  return (target: object, prop: string) => {
    const type = target.constructor as { new (): T };
    defineRelation(type, prop, args);
  };
}

export function OneToOne<T>(args?: RelationToOneProperties<T>) {
  return Relation({ cardinality: 'oneToOne', ...args });
}

export function ManyToOne<T>(args?: RelationToOneProperties<T>) {
  return Relation({ cardinality: 'manyToOne', ...args });
}

export function OneToMany<T>(args: RelationToManyProperties<T>) {
  return Relation({ cardinality: 'oneToMany', ...args });
}

export function ManyToMany<T>(args: RelationToManyProperties<T>) {
  return Relation({ cardinality: 'manyToMany', ...args });
}
