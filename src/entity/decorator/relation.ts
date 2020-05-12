import 'reflect-metadata';
import { defineRelation } from './storage';
import { RelationProperties } from './type';

function Relation(args: RelationProperties) {
  return (target: object, prop: string) => {
    if (args.type === undefined) {
      args.type = () => Reflect.getMetadata('design:type', target, prop);
    }
    const type = target.constructor as { new (): object };
    defineRelation(type, prop, args);
  };
}

export function OneToOne(args?: Omit<RelationProperties, 'cardinality'>) {
  return Relation({ cardinality: 'oneToOne', ...args });
}

export function ManyToOne(args?: Omit<RelationProperties, 'cardinality'>) {
  return Relation({ cardinality: 'manyToOne', ...args });
}
