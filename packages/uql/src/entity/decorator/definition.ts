import 'reflect-metadata';
import { RelationOptions, PropertyOptions, EntityOptions, EntityMeta } from 'uql/type';

const holder = globalThis;
const key = 'uql/entity';
const metas: Map<{ new (): unknown }, EntityMeta<any>> = holder[key] || new Map();
holder[key] = metas;

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  if (metas.has(type)) {
    return metas.get(type);
  }
  const meta: EntityMeta<T> = { type, name: type.name, attributes: {} };
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
  if (hasId(meta)) {
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
    const parentMeta = ensureEntityMeta(parentProto.constructor as { new (): unknown });
    const parentProperties = { ...parentMeta.attributes };
    if (hasId(meta)) {
      for (const prop in parentProperties) {
        if (parentProperties[prop].property.isId) {
          delete parentProperties[prop];
          break;
        }
      }
    }
    meta.attributes = { ...parentProperties, ...meta.attributes };
    parentProto = Object.getPrototypeOf(parentProto);
  }

  const idProperty = Object.keys(meta.attributes).find((key) => meta.attributes[key].property.isId);
  if (!idProperty) {
    throw new TypeError(`'${type.name}' must have one field decorated with @Id`);
  }

  meta.id = { property: idProperty, name: meta.attributes[idProperty].property.name };

  meta.properties = Object.keys(meta.attributes).reduce((acc, prop) => {
    if (meta.attributes[prop].property) {
      acc[prop] = meta.attributes[prop].property;
    }
    return acc;
  }, {} as { [p: string]: PropertyOptions });

  meta.relations = Object.keys(meta.attributes).reduce((acc, prop) => {
    if (meta.attributes[prop].relation) {
      acc[prop] = meta.attributes[prop].relation;
    }
    return acc;
  }, {} as { [p in keyof T]: RelationOptions<T> });

  delete meta.attributes;

  return meta;
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

function hasId<T>(meta: EntityMeta<T>): boolean {
  return Object.keys(meta.attributes).some((prop) => meta.attributes[prop].property?.isId);
}

function isPrimitiveType(type: any): boolean {
  return (
    type === undefined ||
    type === Number ||
    type === String ||
    type === Boolean ||
    type === BigInt ||
    type === Symbol ||
    type === Object
  );
}
