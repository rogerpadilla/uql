import 'reflect-metadata';
import { RelationOptions, PropertyOptions, EntityOptions, EntityMeta } from '../../type';
import { isPrimitiveType, copyAttributes, completeRelations, findId } from './definition.util';

const holder = globalThis;
const key = '@uql/core/entity';
const metas: Map<{ new (): any }, EntityMeta<any>> = holder[key] || new Map();
holder[key] = metas;

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  if (metas.has(type)) {
    return metas.get(type);
  }
  const meta: EntityMeta<T> = { type, name: type.name, attributes: {}, properties: {}, relations: {} };
  metas.set(type, meta);
  return meta;
}

export function defineProperty<T>(type: { new (): T }, prop: string, opts: PropertyOptions): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  const inferredType = Reflect.getMetadata('design:type', type.prototype, prop) as { new (): T };
  meta.attributes[prop] = { ...meta.attributes[prop], property: { name: prop, type: inferredType, ...opts } };
  return meta;
}

export function defineId<T>(type: { new (): T }, prop: string, opts: PropertyOptions): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  const id = findId(meta);
  if (id) {
    throw new TypeError(`'${type.name}' must have a single field decorated with @Id`);
  }
  return defineProperty(type, prop, { ...opts, isId: true });
}

export function defineRelation<T>(type: { new (): T }, prop: string, opts: RelationOptions<T>): EntityMeta<T> {
  if (!opts.type) {
    const inferredType = Reflect.getMetadata('design:type', type.prototype, prop) as { new (): T };
    const isPrimitive = isPrimitiveType(inferredType);
    if (isPrimitive) {
      throw new TypeError(`'${type.name}.${prop}' type was auto-inferred with invalid type '${inferredType?.name}'`);
    }
    opts.type = () => inferredType;
  }
  const meta = ensureEntityMeta(type);
  meta.attributes[prop] = { ...meta.attributes[prop], relation: opts };
  return meta;
}

export function defineEntity<T>(type: { new (): T }, opts: EntityOptions = {}): EntityMeta<T> {
  const meta = ensureEntityMeta(type);

  if (Object.keys(meta.attributes).length === 0) {
    throw new TypeError(`'${type.name}' must have properties`);
  }

  meta.name = opts.name || type.name;
  let parentProto: object = Object.getPrototypeOf(type.prototype);

  while (parentProto.constructor !== Object) {
    const parentMeta = ensureEntityMeta(parentProto.constructor as { new (): any });
    copyAttributes(parentMeta, meta);
    parentProto = Object.getPrototypeOf(parentProto);
  }

  const id = findId(meta);
  if (!id) {
    throw new TypeError(`'${type.name}' must have one field decorated with @Id`);
  }
  meta.id = id;

  Object.keys(meta.attributes).forEach((prop) => {
    if (meta.attributes[prop].property) {
      meta.properties[prop] = meta.attributes[prop].property;
    } else {
      meta.relations[prop] = meta.attributes[prop].relation;
    }
  });

  delete meta.attributes;

  return completeRelations(meta);
}

export function getEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  const meta = metas.get(type);
  if (!meta?.id) {
    throw new TypeError(`'${type.name}' is not an entity`);
  }
  return meta;
}

export function getEntities() {
  return Array.from(metas.entries()).reduce((acc, [key, val]) => {
    if (val.id) {
      acc.push(key);
    }
    return acc;
  }, []);
}
