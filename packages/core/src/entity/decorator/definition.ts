import { startLowerCase, startUpperCase } from '@uql/core/util';
import 'reflect-metadata';
import { RelationOptions, PropertyOptions, EntityOptions, EntityMeta } from '../../type';

const holder = globalThis;
const key = '@uql/core/entity';
const metas: Map<{ new (): any }, EntityMeta<any>> = holder[key] || new Map();
holder[key] = metas;

export function defineProperty<T>(type: { new (): T }, prop: string, opts: PropertyOptions): EntityMeta<T> {
  const meta = ensureEntityMeta(type);
  const inferredType = Reflect.getMetadata('design:type', type.prototype, prop) as { new (): T };
  meta.properties[prop] = { ...meta.properties[prop], ...{ name: prop, type: inferredType, ...opts } };
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
  meta.relations[prop] = { ...meta.relations[prop], ...opts };
  return meta;
}

export function defineEntity<T>(type: { new (): T }, opts: EntityOptions = {}): EntityMeta<T> {
  const meta = ensureEntityMeta(type);

  if (Object.keys(meta.properties).length === 0) {
    throw new TypeError(`'${type.name}' must have properties`);
  }

  meta.name = opts.name || type.name;
  let parentProto: object = Object.getPrototypeOf(type.prototype);

  while (parentProto.constructor !== Object) {
    const parentMeta = ensureEntityMeta(parentProto.constructor as { new (): any });
    extend(parentMeta, meta);
    parentProto = Object.getPrototypeOf(parentProto);
  }

  const id = findId(meta);
  if (!id) {
    throw new TypeError(`'${type.name}' must have one field decorated with @Id`);
  }
  meta.id = id;

  return meta;
}

export function getEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  const meta = metas.get(type);
  if (!meta?.id) {
    throw new TypeError(`'${type.name}' is not an entity`);
  }
  if (meta.processed) {
    return meta;
  }
  meta.processed = true;
  return completeRelations(meta);
}

export function getEntities() {
  return Array.from(metas.entries()).reduce((acc, [key, val]) => {
    if (val.id) {
      acc.push(key);
    }
    return acc;
  }, []);
}

function ensureEntityMeta<T>(type: { new (): T }): EntityMeta<T> {
  if (metas.has(type)) {
    return metas.get(type);
  }
  const meta: EntityMeta<T> = { type, name: type.name, properties: {}, relations: {} };
  metas.set(type, meta);
  return meta;
}

function completeRelations<T>(meta: EntityMeta<T>) {
  for (const relKey in meta.relations) {
    const rel = meta.relations[relKey];
    if (!rel.references) {
      const relType = rel.type();
      const relMeta = ensureEntityMeta(relType);
      if (rel.cardinality === 'manyToMany') {
        rel.through = `${meta.name}${relMeta.name}`;
        const source = startLowerCase(meta.name) + startUpperCase(meta.id.name);
        const target = startLowerCase(relMeta.name) + startUpperCase(relMeta.id.name);
        rel.references = [
          { source, target: meta.id.name },
          { source: target, target: relMeta.id.name },
        ];
      } else if (rel.mappedBy) {
        rel.references = [{ source: meta.id.property, target: rel.mappedBy as string }];
      } else {
        const defaultSourcePropertyName = relKey + startUpperCase(relMeta.id.property);
        const defaultSourceProperty = meta.properties[defaultSourcePropertyName];
        if (defaultSourceProperty) {
          rel.references = [{ source: defaultSourcePropertyName, target: relMeta.id.property }];
        }
      }
    }
  }
  return meta;
}

function findId<T>(meta: EntityMeta<T>) {
  const propertyName = Object.keys(meta.properties).find((attribute) => meta.properties[attribute]?.isId);
  if (!propertyName) {
    return;
  }
  return { ...meta.properties[propertyName], property: propertyName };
}

function extend<T>(source: EntityMeta<T>, target: EntityMeta<T>) {
  const sourceProperties = { ...source.properties };
  const targetId = findId(target);
  if (targetId) {
    const sourceId = findId(source);
    if (sourceId) {
      delete sourceProperties[sourceId.property];
    }
  }
  target.properties = { ...sourceProperties, ...target.properties };
  target.relations = { ...source.relations, ...target.relations };
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
