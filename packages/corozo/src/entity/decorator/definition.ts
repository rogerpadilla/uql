import 'reflect-metadata';
import { RelationOptions, PrimaryColumnOptions, EntityOptions, EntityMeta, ColumnOptions } from './type';

const entitiesMeta = new Map<{ new (): any }, EntityMeta<any>>();

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  if (!entitiesMeta.has(type)) {
    entitiesMeta.set(type, { type, name: type.name, properties: {} });
  }
  const meta: EntityMeta<T> = entitiesMeta.get(type);
  return meta;
}

export function defineColumn<T>(type: { new (): T }, prop: string, opts: ColumnOptions<T>): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  meta.properties[prop] = { ...meta.properties[prop], column: { name: prop, ...opts } };
  return meta;
}

export function definePrimaryColumn<T>(
  type: { new (): T },
  prop: string,
  opts: PrimaryColumnOptions<T>
): EntityMeta<T> {
  const meta = defineColumn(type, prop, { mode: 'read', ...opts });
  if (meta.id) {
    throw new Error(`'${type.name}' must have a single field decorated with @PrimaryColumn`);
  }
  meta.id = prop;
  return meta;
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

export function defineEntity<T>(type: { new (): T }, opts?: EntityOptions): EntityMeta<T> {
  const meta: EntityMeta<T> = entitiesMeta.get(type);
  if (!meta) {
    throw new Error(`'${type.name}' must have columns`);
  }

  meta.name = opts?.name || type.name;
  let parentProto: object = Object.getPrototypeOf(type.prototype);

  while (parentProto.constructor !== Object) {
    const parentMeta = entitiesMeta.get(parentProto.constructor as { new (): any });
    const parentProperties = { ...parentMeta.properties };
    if (meta.id) {
      delete parentProperties[parentMeta.id];
    } else {
      meta.id = parentMeta.id;
    }
    meta.properties = { ...parentProperties, ...meta.properties };
    parentProto = Object.getPrototypeOf(parentProto);
  }

  if (!meta.id) {
    throw new Error(`'${type.name}' must have at least one field decorated with @PrimaryColumn`);
  }

  // readonly shorthands for accesing 'columns' and 'relations',
  // that way 'properties' can be used as single source of truth
  Object.defineProperties(meta, {
    columns: {
      value: Object.keys(meta.properties).reduce((acc, prop) => {
        if (meta.properties[prop].column) {
          acc[prop] = meta.properties[prop].column;
        }
        return acc;
      }, {} as { [p in keyof T]: ColumnOptions<T> }),
    },
    relations: {
      value: Object.keys(meta.properties).reduce((acc, prop) => {
        if (meta.properties[prop].relation) {
          acc[prop] = meta.properties[prop].relation;
        }
        return acc;
      }, {} as { [p in keyof T]: RelationOptions<T> }),
    },
  });

  meta.isEntity = true;

  return meta;
}

export function getEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  const meta: EntityMeta<T> = entitiesMeta.get(type);
  if (!meta?.isEntity) {
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
