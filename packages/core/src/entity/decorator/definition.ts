import 'reflect-metadata';
import { startLowerCase, startUpperCase } from '../../util';
import {
  RelationOptions,
  PropertyOptions,
  EntityOptions,
  EntityMeta,
  Type,
  PropertyNameMap,
  PropertyNameMapper,
  RelationMappedBy,
} from '../../type';

const holder = globalThis;
const metaKey = '@uql/core/entity';
const metas: Map<Type<any>, EntityMeta<any>> = holder[metaKey] ?? new Map();
holder[metaKey] = metas;

export function defineProperty<E>(entity: Type<E>, prop: string, opts: PropertyOptions): EntityMeta<E> {
  const meta = ensureMeta(entity);
  const inferredType = Reflect.getMetadata('design:type', entity.prototype, prop);
  meta.properties[prop] = { ...meta.properties[prop], ...{ name: prop, type: inferredType, ...opts } };
  return meta;
}

export function defineId<E>(entity: Type<E>, prop: string, opts: PropertyOptions): EntityMeta<E> {
  const meta = ensureMeta(entity);
  const id = getId(meta);
  if (id) {
    throw new TypeError(`'${entity.name}' must have a single field decorated with @Id`);
  }
  return defineProperty(entity, prop, { ...opts, isId: true });
}

export function defineRelation<E>(entity: Type<E>, prop: string, opts: RelationOptions<E>): EntityMeta<E> {
  if (!opts.entity) {
    const inferredType = inferRelationType(entity, prop);
    opts.entity = () => inferredType;
  }
  const meta = ensureMeta(entity);
  meta.relations[prop] = { ...meta.relations[prop], ...opts };
  return meta;
}

export function define<E>(entity: Type<E>, opts: EntityOptions = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);

  if (Object.keys(meta.properties).length === 0) {
    throw new TypeError(`'${entity.name}' must have properties`);
  }

  meta.name = opts.name ?? entity.name;
  let parentProto: object = Object.getPrototypeOf(entity.prototype);

  while (parentProto.constructor !== Object) {
    const parentMeta = ensureMeta(parentProto.constructor as Type<E>);
    extend(parentMeta, meta);
    parentProto = Object.getPrototypeOf(parentProto);
  }

  const id = getId(meta);
  if (!id) {
    throw new TypeError(`'${entity.name}' must have one field decorated with @Id`);
  }
  meta.id = { ...meta.properties[id], property: id };

  return meta;
}

export function getMeta<E>(entity: Type<E>): EntityMeta<E> {
  const meta = metas.get(entity);
  if (!meta) {
    throw new TypeError(`'${entity.name}' is not an entity`);
  }
  if (meta.processed) {
    return meta;
  }
  meta.processed = true;
  return completeRelationsMetas(meta);
}

export function getEntities(): Type<any>[] {
  return [...metas.entries()].reduce((acc, [key, val]) => {
    if (val.id) {
      acc.push(key);
    }
    return acc;
  }, []);
}

function ensureMeta<E>(entity: Type<E>): EntityMeta<E> {
  let meta = metas.get(entity);
  if (meta) {
    return meta;
  }
  meta = { entity: entity, name: entity.name, properties: {}, relations: {} };
  metas.set(entity, meta);
  return meta;
}

function completeRelationsMetas<E>(meta: EntityMeta<E>): EntityMeta<E> {
  for (const relKey in meta.relations) {
    const rel = meta.relations[relKey];

    if (rel.references) {
      continue;
    }

    const relEntity = rel.entity();
    const relMeta = getMeta(relEntity);

    if (rel.mappedBy) {
      if (typeof rel.mappedBy === 'function') {
        const propertyNameMap = getKeyNameMap(relMeta);
        const nameMapper = rel.mappedBy as PropertyNameMapper<E>;
        const mappedByKey = nameMapper(propertyNameMap);
        if (relMeta.relations[mappedByKey]) {
          const references = relMeta.relations[mappedByKey].references.slice();
          rel.mappedBy = references[0].source as RelationMappedBy<E>;
          rel.references = references.map(({ source, target }) => ({ source: target, target: source }));
        } else {
          rel.mappedBy = mappedByKey as RelationMappedBy<E>;
          rel.references = [{ source: meta.id.property, target: rel.mappedBy as string }];
        }
      } else {
        rel.references = [{ source: meta.id.property, target: rel.mappedBy as string }];
      }
    } else if (rel.cardinality === 'manyToMany') {
      rel.through = `${meta.name}${relMeta.name}`;
      const source = startLowerCase(meta.name) + startUpperCase(meta.id.name);
      const target = startLowerCase(relMeta.name) + startUpperCase(relMeta.id.name);
      rel.references = [
        { source, target: meta.id.name },
        { source: target, target: relMeta.id.name },
      ];
    } else {
      rel.references = [{ source: relKey + 'Id', target: relMeta.id.property }];
    }
  }

  return meta;
}

function getKeyNameMap<E>(meta: EntityMeta<E>): PropertyNameMap<E> {
  return Object.keys(meta.properties)
    .concat(Object.keys(meta.relations))
    .reduce((acc, key) => {
      acc[key] = key;
      return acc;
    }, {} as PropertyNameMap<E>);
}

function getId<E>(meta: EntityMeta<E>): string {
  return meta.id?.property ?? Object.keys(meta.properties).find((attribute) => meta.properties[attribute]?.isId);
}

function extend<E>(source: EntityMeta<E>, target: EntityMeta<E>) {
  const sourceProperties = { ...source.properties };
  const targetId = getId(target);
  if (targetId) {
    const sourceId = getId(source);
    if (sourceId) {
      delete sourceProperties[sourceId];
    }
  }
  target.properties = { ...sourceProperties, ...target.properties };
  target.relations = { ...source.relations, ...target.relations };
}

function inferRelationType<E>(entity: Type<E>, prop: string): Type<any> {
  const inferredType = Reflect.getMetadata('design:type', entity.prototype, prop);
  const isValidType = isValidEntityType(inferredType);
  if (!isValidType) {
    throw new TypeError(`'${entity.name}.${prop}' type was auto-inferred with invalid type '${inferredType?.name}'`);
  }
  return inferredType;
}

function isValidEntityType(type: any): type is Type<any> {
  return (
    typeof type === 'function' &&
    type !== Boolean &&
    type !== String &&
    type !== Number &&
    type !== BigInt &&
    type !== Date &&
    type !== Symbol &&
    type !== Object
  );
}
