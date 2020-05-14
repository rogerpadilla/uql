import { RelationProperties, ColumnProperties, PrimaryColumnProperties } from './type';

const entitiesMeta = new Map<
  { new (): any },
  {
    id?: string;
    columns: {
      [prop: string]: ColumnProperties;
    };
    relations: {
      [prop: string]: RelationProperties<any>;
    };
    merged?: boolean;
  }
>();

function ensureEntityMeta<T>(type: { new (): T }) {
  if (!entitiesMeta.has(type)) {
    entitiesMeta.set(type, { columns: {}, relations: {} });
  }
  return entitiesMeta.get(type);
}

export function defineColumn<T>(type: { new (): T }, prop: string, args: ColumnProperties) {
  const meta = getEntityMeta(type);
  meta.columns[prop] = args;
  return meta;
}

export function definePrimaryColumn<T>(type: { new (): T }, prop: string, args: PrimaryColumnProperties) {
  const meta = defineColumn(type, prop, { mode: 'read', ...args });
  meta.id = prop;
  return meta;
}

export function defineRelation<T>(type: { new (): T }, prop: string, args: RelationProperties<T>) {
  const meta = getEntityMeta(type);
  meta.relations[prop] = args;
  return meta;
}

export function getEntityMeta<T>(type: { new (): T }) {
  const meta = ensureEntityMeta(type);
  if (meta.merged) {
    return meta;
  }
  let parentProto = Object.getPrototypeOf(type.prototype);
  while (parentProto.constructor !== Object) {
    const parentMeta = entitiesMeta.get(parentProto.constructor);
    meta.id = meta.id || parentMeta.id;
    meta.columns = { ...parentMeta.columns, ...meta.columns };
    meta.relations = { ...parentMeta.relations, ...meta.relations };
    parentProto = Object.getPrototypeOf(parentProto);
  }
  meta.merged = true;
  return meta;
}

export function getEntityId<T>(type: { new (): T }) {
  const meta = getEntityMeta(type);
  return meta.id;
}

export function getEntities() {
  return entitiesMeta.keys();
}
