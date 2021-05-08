import {
  RelationOptions,
  RelationOneToOneOptions,
  RelationOneToManyOptions,
  RelationManyToOneOptions,
  RelationManyToManyOptions,
} from '../../type';
import { defineRelation } from './definition';

function Relation<E>(opts: RelationOptions<E>) {
  return (target: object, prop: string) => {
    const entity = target.constructor as { new (): E };
    defineRelation(entity, prop, opts);
  };
}

export function OneToOne<E>(opts?: RelationOneToOneOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: 'oneToOne', ...opts });
}

export function ManyToOne<E>(opts?: RelationManyToOneOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: 'manyToOne', ...opts });
}

export function OneToMany<E>(opts: RelationOneToManyOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: 'oneToMany', ...opts });
}

export function ManyToMany<E>(opts: RelationManyToManyOptions<E>): ReturnType<typeof Relation> {
  return Relation({ cardinality: 'manyToMany', ...opts });
}
