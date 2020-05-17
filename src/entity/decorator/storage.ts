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
    merged?: boolean;
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
  meta.id = prop;
  return meta;
}

export function defineRelation<T>(type: { new (): T }, prop: string, args: RelationProperties<T>) {
  if (args.type === undefined) {
    args.type = () => Reflect.getMetadata('design:type', type.prototype, prop);
  }
  const meta = ensureEntityMeta(type);
  if (!meta.columns[prop]) {
    meta.columns[prop] = {};
  }
  meta.columns[prop] = { ...meta.columns[prop], relation: args };
  return meta;
}

export function defineEntity<T>(type: { new (): T }, args?: EntityProperties) {
  const meta = ensureEntityMeta(type);
  meta.name = args?.name || type.name;
  return meta;
}

export function getEntityMeta<T>(type: { new (): T }) {
  const meta = entitiesMeta.get(type);
  if (meta.merged) {
    return meta;
  }
  let parentProto = Object.getPrototypeOf(type.prototype);
  while (parentProto.constructor !== Object) {
    const parentMeta = entitiesMeta.get(parentProto.constructor);
    meta.id = meta.id || parentMeta.id;
    meta.columns = { ...parentMeta.columns, ...meta.columns };
    parentProto = Object.getPrototypeOf(parentProto);
  }
  meta.merged = true;
  return meta;
}

export function getEntities() {
  return entitiesMeta.keys();
}
