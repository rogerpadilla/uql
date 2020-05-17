import 'reflect-metadata';
import { RelationProperties, ColumnProperties, PrimaryColumnProperties, EntityProperties, EntityMeta } from './type';

const entitiesMeta = new Map<{ new (): any }, EntityMeta<any>>();

function ensureEntityMeta<T>(type: { new (): T }) {
  if (!entitiesMeta.has(type)) {
    entitiesMeta.set(type, { type, name: type.name, columns: {} });
  }
  const meta: EntityMeta<T> = entitiesMeta.get(type);
  return meta;
}

export function defineColumn<T>(type: { new (): T }, prop: string, args: ColumnProperties) {
  const meta = ensureEntityMeta(type);
  meta.columns[prop] = { ...meta.columns[prop], name: prop, ...args };
  return meta;
}

export function definePrimaryColumn<T>(type: { new (): T }, prop: string, args: PrimaryColumnProperties) {
  const meta = defineColumn(type, prop, { mode: 'read', ...args });
  if (meta.id) {
    throw new Error(`'${type.name}' must have a single field decorated with @PrimaryColumn`);
  }
  meta.id = prop;
  return meta;
}

export function defineRelation<T>(type: { new (): T }, prop: string, args: RelationProperties<T>) {
  if (args.type === undefined) {
    const inferredType = Reflect.getMetadata('design:type', type.prototype, prop);
    const isPrimitive = isPrimitiveType(inferredType);
    if (isPrimitive) {
      throw new Error(`'${type.name}.${prop}' type was auto-inferred with invalid type '${inferredType?.name}'`);
    }
    args.type = () => inferredType;
  }
  const meta = ensureEntityMeta(type);
  meta.columns[prop] = { name: prop, ...meta.columns[prop], relation: args };
  return meta;
}

export function defineEntity<T>(type: { new (): T }, args?: EntityProperties) {
  const meta: EntityMeta<T> = entitiesMeta.get(type);
  if (!meta) {
    throw new Error(`'${type.name}' must have columns`);
  }
  meta.name = args?.name || type.name;
  let parentProto = Object.getPrototypeOf(type.prototype);
  while (parentProto.constructor !== Object) {
    const parentMeta = entitiesMeta.get(parentProto.constructor);
    meta.id = meta.id || parentMeta.id;
    meta.columns = { ...parentMeta.columns, ...meta.columns };
    parentProto = Object.getPrototypeOf(parentProto);
  }
  if (!meta.id) {
    throw new Error(`'${type.name}' must have at least one field decorated with @PrimaryColumn`);
  }
  meta.isEntity = true;
  return meta;
}

export function getEntityMeta<T>(type: { new (): T }) {
  const meta: EntityMeta<T> = entitiesMeta.get(type);
  if (!meta?.isEntity) {
    throw new Error(`'${type.name}' is not an entity`);
  }
  return meta;
}

export function getEntities() {
  return Array.from(entitiesMeta.values()).reduce((acc, it) => {
    if (it.isEntity) {
      acc.push(it.type);
    }
    return acc;
  }, [] as { new (): any }[]);
}

function isPrimitiveType(type: any) {
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
