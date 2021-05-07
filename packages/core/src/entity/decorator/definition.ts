import { startLowerCase, startUpperCase } from '@uql/core/util';
import 'reflect-metadata';
import { RelationOptions, PropertyOptions, EntityOptions, EntityMeta } from '../../type';

const holder = globalThis;
const key = '@uql/core/entity';
const metas: Map<{ new (): any }, EntityMeta<any>> = holder[key] || new Map();
holder[key] = metas;

export function defineProperty<T>(type: { new (): T }, prop: string, opts: PropertyOptions): EntityMeta<T> {
  const meta = ensureMeta(type);
  const inferredType = Reflect.getMetadata('design:type', type.prototype, prop) as { new (): T };
  meta.properties[prop] = { ...meta.properties[prop], ...{ name: prop, type: inferredType, ...opts } };
  return meta;
}

export function defineId<T>(type: { new (): T }, prop: string, opts: PropertyOptions): EntityMeta<T> {
  const meta = ensureMeta(type);
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
  const meta = ensureMeta(type);
  meta.relations[prop] = { ...meta.relations[prop], ...opts };
  return meta;
}

export function define<T>(type: { new (): T }, opts: EntityOptions = {}): EntityMeta<T> {
  const meta = ensureMeta(type);

  if (Object.keys(meta.properties).length === 0) {
    throw new TypeError(`'${type.name}' must have properties`);
  }

  meta.name = opts.name || type.name;
  let parentProto: object = Object.getPrototypeOf(type.prototype);

  while (parentProto.constructor !== Object) {
    const parentMeta = ensureMeta(parentProto.constructor as { new (): any });
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

export function getMeta<T>(type: { new (): T }): EntityMeta<T> {
  const meta = metas.get(type);
  if (!meta?.id) {
    throw new TypeError(`'${type.name}' is not an entity`);
  }
  if (meta.processed) {
    return meta;
  }
  meta.processed = true;
  return inferReferences(meta);
}

export function getEntities() {
  return Array.from(metas.entries()).reduce((acc, [key, val]) => {
    if (val.id) {
      acc.push(key);
    }
    return acc;
  }, []);
}

function ensureMeta<T>(type: { new (): T }): EntityMeta<T> {
  let meta = metas.get(type);
  if (meta) {
    return meta;
  }
  meta = { type, name: type.name, properties: {}, relations: {} };
  metas.set(type, meta);
  return meta;
}

function inferReferences<T>(meta: EntityMeta<T>) {
  for (const relKey in meta.relations) {
    const rel = meta.relations[relKey];

    if (rel.references) {
      continue;
    }

    const relType = rel.type();
    const relMeta = ensureMeta(relType);

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
      if (meta.properties[defaultSourcePropertyName]) {
        rel.references = [{ source: defaultSourcePropertyName, target: relMeta.id.property }];
      } else {
        const [key] = Object.entries(meta.properties).find(([key, val]) => val.reference?.type() === relType);
        if (key) {
          rel.references = [{ source: key, target: relMeta.id.property }];
        } else {
          // TODO: auto-infer name of fk-col if there are not explicit fks to that relType
          console.warn(`missing reference ${meta.type.name}.${relKey} -> ${relType.name}`);
        }
      }
    }
  }

  return meta;
}

function findId<T>(meta: EntityMeta<T>) {
  const key = Object.keys(meta.properties).find((attribute) => meta.properties[attribute]?.isId);
  if (key) {
    return { ...meta.properties[key], property: key };
  }
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
