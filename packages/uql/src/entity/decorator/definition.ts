import 'reflect-metadata';
import { RelationOptions, ColumnOptions, EntityOptions, EntityMeta } from './type';

declare const window: any;
const holder = typeof window === 'object' ? window : {};
const key = 'uql/entitiesMeta';
const metas: Map<{ new (): unknown }, EntityMeta<any>> = holder[key] || new Map();
holder[key] = metas;

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  if (metas.has(type)) {
    return metas.get(type);
  }
  const meta: EntityMeta<T> = { type, name: type.name, properties: {} };
  Object.defineProperty(meta, 'hasId', {
    value: () => Object.keys(meta.properties).some((prop) => meta.properties[prop].column?.isId),
  });
  metas.set(type, meta);
  return meta;
}

export function defineColumn<T>(type: { new (): T }, prop: string, opts: ColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  meta.properties[prop] = { ...meta.properties[prop], column: { name: prop, ...opts } };
  return meta;
}

export function defineId<T>(type: { new (): T }, prop: string, opts: ColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  if (meta.hasId()) {
    throw new TypeError(`'${type.name}' must have a single field decorated with @Id`);
  }
  return defineColumn(type, prop, { ...opts, isId: true });
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
  meta.properties[prop] = { ...meta.properties[prop], relation: opts };
  return meta;
}

export function defineEntity<T>(type: { new (): T }, opts: EntityOptions = {}): EntityMeta<T> {
  const meta = ensureEntityMeta(type);

  if (Object.keys(meta.properties).length === 0) {
    throw new TypeError(`'${type.name}' must have columns`);
  }

  meta.name = opts.name || type.name;
  let parentProto: object = Object.getPrototypeOf(type.prototype);

  while (parentProto.constructor !== Object) {
    const parentMeta = ensureEntityMeta(parentProto.constructor as { new (): unknown });
    const parentProperties = { ...parentMeta.properties };
    if (meta.hasId()) {
      for (const prop in parentProperties) {
        if (parentProperties[prop].column?.isId) {
          delete parentProperties[prop];
          break;
        }
      }
    }
    meta.properties = { ...parentProperties, ...meta.properties };
    parentProto = Object.getPrototypeOf(parentProto);
  }

  const idProperty = Object.keys(meta.properties).find((key) => meta.properties[key].column?.isId);
  if (!idProperty) {
    throw new TypeError(`'${type.name}' must have one field decorated with @Id`);
  }

  Object.defineProperty(meta, 'id', {
    value: { property: idProperty, name: meta.properties[idProperty].column.name },
    enumerable: true,
  });
  Object.defineProperty(meta, 'columns', {
    value: Object.keys(meta.properties).reduce((acc, prop) => {
      if (meta.properties[prop].column) {
        acc[prop] = meta.properties[prop].column;
      }
      return acc;
    }, {} as { [p in keyof T]: ColumnOptions<T> }),
  });
  Object.defineProperty(meta, 'relations', {
    value: Object.keys(meta.properties).reduce((acc, prop) => {
      if (meta.properties[prop].relation) {
        acc[prop] = meta.properties[prop].relation;
      }
      return acc;
    }, {} as { [p in keyof T]: RelationOptions<T> }),
  });

  return meta;
}

export function getEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  if (!meta.id) {
    throw new TypeError(`'${type.name}' is not an entity`);
  }
  return meta;
}

export function getEntities() {
  return Array.from(metas.keys());
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
