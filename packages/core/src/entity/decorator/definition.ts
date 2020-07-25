import 'reflect-metadata';
import { RelationOptions, ColumnOptions, EntityOptions, EntityMeta } from './type';

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  const metaKey = '_onql_meta_' + type.name;
  if (type[metaKey]) {
    return type[metaKey];
  }
  const meta: EntityMeta<T> = { type, name: type.name, properties: {} };
  Object.defineProperty(meta, 'hasId', {
    value: () => Object.keys(meta.properties).some((prop) => meta.properties[prop].column?.isId),
  });
  type[metaKey] = meta;
  return meta;
}

export function defineColumn<T>(type: { new (): T }, prop: string, opts: ColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  meta.properties[prop] = { ...meta.properties[prop], column: { name: prop, ...opts } };
  return meta;
}

export function defineIdColumn<T>(type: { new (): T }, prop: string, opts: ColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  if (meta.hasId()) {
    throw new Error(`'${type.name}' must have a single field decorated with @IdColumn`);
  }
  return defineColumn(type, prop, { ...opts, isId: true });
}

export function defineRelation<T>(type: { new (): T }, prop: string, opts: RelationOptions<T>): EntityMeta<T> {
  if (!opts.type) {
    const inferredType = Reflect.getMetadata('design:type', type.prototype, prop) as { new (): T };
    const isPrimitive = isPrimitiveType(inferredType);
    if (isPrimitive) {
      throw new Error(`'${type.name}.${prop}' type was auto-inferred with invalid type '${inferredType?.name}'`);
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
    throw new Error(`'${type.name}' must have columns`);
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

  let idProperty: string;
  for (const prop in meta.properties) {
    if (meta.properties[prop].column?.isId) {
      idProperty = prop;
      break;
    }
  }

  if (!idProperty) {
    throw new Error(`'${type.name}' must have one field decorated with @IdColumn`);
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
    throw new Error(`'${type.name}' is not an entity`);
  }
  return meta;
}

export function getEntities(): { new (): object }[] {
  // FIXME
  return [];
  // return Array.from(entitiesMeta.values()).reduce((acc, it) => {
  //   if (it.id) {
  //     acc.push(it.type);
  //   }
  //   return acc;
  // }, [] as { new (): object }[]);
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
