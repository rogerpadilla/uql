import 'reflect-metadata';
import { RelationOptions, IdColumnOptions, EntityOptions, EntityMeta } from './type';

const entitiesMeta = new Map<{ new (): any }, EntityMeta<any>>();

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  if (entitiesMeta.has(type)) {
    return entitiesMeta.get(type);
  }

  const meta: EntityMeta<T> = { type, name: type.name, properties: {} };

  // readonly shorthands for accesing metadata, this way 'properties'
  // can be keep as single source of truth.
  Object.defineProperty(meta, 'id', {
    get() {
      for (const prop in meta.properties) {
        if (meta.properties[prop].column?.isId) {
          return meta.properties[prop].column;
        }
      }
    },
  });

  Object.defineProperty(meta, 'columns', {
    get() {
      return Object.keys(meta.properties).reduce((acc, prop) => {
        if (meta.properties[prop].column) {
          acc[prop] = meta.properties[prop].column;
        }
        return acc;
      }, {} as { [p in keyof T]: IdColumnOptions<T> });
    },
  });

  Object.defineProperty(meta, 'relations', {
    get() {
      return Object.keys(meta.properties).reduce((acc, prop) => {
        if (meta.properties[prop].relation) {
          acc[prop] = meta.properties[prop].relation;
        }
        return acc;
      }, {} as { [p in keyof T]: RelationOptions<T> });
    },
  });

  entitiesMeta.set(type, meta);

  return meta;
}

export function defineColumn<T>(type: { new (): T }, prop: string, opts: IdColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  meta.properties[prop] = { ...meta.properties[prop], column: { name: prop, ...opts, property: prop } };
  return meta;
}

export function defineIdColumn<T>(type: { new (): T }, prop: string, opts: IdColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  if (meta.id) {
    throw new Error(`'${type.name}' must have a single field decorated with @IdColumn`);
  }
  return defineColumn(type, prop, { ...opts, mode: 'read', isId: true });
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
    if (meta.id) {
      delete parentProperties[parentMeta.id.property];
    }
    meta.properties = { ...parentProperties, ...meta.properties };
    parentProto = Object.getPrototypeOf(parentProto);
  }

  if (!meta.id) {
    throw new Error(`'${type.name}' must have one field decorated with @IdColumn`);
  }

  meta.isEntity = true;

  return meta;
}

export function getEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  if (!meta.isEntity) {
    throw new Error(`'${type.name}' is not an entity`);
  }
  return meta;
}

export function getEntities(): { new (): object }[] {
  return Array.from(entitiesMeta.values()).reduce((acc, it) => {
    if (it.isEntity) {
      acc.push(it.type);
    }
    return acc;
  }, [] as { new (): object }[]);
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
