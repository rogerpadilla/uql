import 'reflect-metadata';
import { RelationProperties, ColumnProperties, PrimaryColumnProperties, EntityProperties } from './type';

const entitiesMeta = new Map<
  { new (): any },
  {
    id?: string;
    name?: string;
    columns: {
      [prop: string]: ColumnProperties;
    };
    isValid?: boolean;
  }
>();

function ensureEntityMeta<T>(type: { new (): T }) {
  if (!entitiesMeta.has(type)) {
    entitiesMeta.set(type, { columns: {} });
  }
  return entitiesMeta.get(type);
}

export function defineColumn<T>(type: { new (): T }, prop: string, args: ColumnProperties) {
  const meta = ensureEntityMeta(type);
  meta.columns[prop] = { name: prop, ...args };
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
    args.type = () => Reflect.getMetadata('design:type', type.prototype, prop);
    const fieldType = args.type();
    const isPrimitive = isPrimitiveType(fieldType);
    if (isPrimitive) {
      throw new Error(`'${type.name}.${prop}' type was auto-inferred with invalid type '${fieldType?.name}'`);
    }
  }
  const meta = ensureEntityMeta(type);
  if (!meta.columns[prop]) {
    meta.columns[prop] = {};
  }
  meta.columns[prop] = { ...meta.columns[prop], relation: args };
  return meta;
}

export function defineEntity<T>(type: { new (): T }, args?: EntityProperties) {
  const meta = entitiesMeta.get(type);
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
  meta.isValid = true;
  return meta;
}

export function getEntityMeta<T>(type: { new (): T }) {
  const meta = entitiesMeta.get(type);
  if (!meta?.isValid) {
    throw new Error(`'${type.name}' must be decorated with @Entity`);
  }
  return meta;
}

export function getEntities() {
  return entitiesMeta.keys();
}

function isPrimitiveType(type: any) {
  return type === undefined || type === Number || type === String || type === Boolean || type === Object;
}
