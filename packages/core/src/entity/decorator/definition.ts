import 'reflect-metadata';
import { hasKeys, lowerFirst, getKeys, upperFirst } from '../../util';
import {
  RelationOptions,
  FieldOptions,
  EntityOptions,
  EntityMeta,
  Type,
  KeyMapper,
  RelationMappedBy,
  KeyMap,
  ReferenceOptions,
  RelationKey,
  FieldKey,
  Key,
} from '../../type';

const holder = globalThis;
const metaKey = '@uql/core/entity/decorator';
const metas: Map<Type<any>, EntityMeta<any>> = holder[metaKey] ?? new Map();
holder[metaKey] = metas;

export function defineField<E>(entity: Type<E>, key: string, opts: FieldOptions = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (!opts.type) {
    const type = inferType(entity, key);
    opts = { ...opts, type };
  }
  if (typeof opts.reference === 'function') {
    opts = { ...opts, reference: { entity: opts.reference } };
  }
  meta.fields[key] = { ...meta.fields[key], ...{ name: key, ...opts } };
  return meta;
}

export function defineId<E>(entity: Type<E>, key: string, opts: FieldOptions): EntityMeta<E> {
  const meta = ensureMeta(entity);
  const id = getId(meta);
  if (id) {
    throw new TypeError(`'${entity.name}' must have a single field decorated with @Id`);
  }
  return defineField(entity, key, { ...opts, isId: true });
}

export function defineRelation<E>(entity: Type<E>, key: string, opts: RelationOptions<E>): EntityMeta<E> {
  if (!opts.entity) {
    const inferredType = inferEntityType(entity, key);
    opts.entity = () => inferredType;
  }
  const meta = ensureMeta(entity);
  meta.relations[key] = { ...meta.relations[key], ...opts };
  return meta;
}

export function defineEntity<E>(entity: Type<E>, opts: EntityOptions = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);

  if (!hasKeys(meta.fields)) {
    throw new TypeError(`'${entity.name}' must have fields`);
  }

  const onDeleteKeys = getKeys(meta.fields).filter((key) => meta.fields[key].onDelete) as FieldKey<E>[];

  if (onDeleteKeys.length > 1) {
    throw new TypeError(`'${entity.name}' must have one field with 'onDelete' as maximum`);
  }

  if (opts.softDelete) {
    if (!onDeleteKeys.length) {
      throw new TypeError(`'${entity.name}' must have one field with 'onDelete' to enable 'softDelete'`);
    }
    meta.softDeleteKey = onDeleteKeys[0];
  }

  meta.name = opts.name ?? entity.name;
  let proto: FunctionConstructor = Object.getPrototypeOf(entity.prototype);

  while (proto.constructor !== Object) {
    const parentMeta = ensureMeta(proto.constructor as Type<E>);
    extend(parentMeta, meta);
    proto = Object.getPrototypeOf(proto);
  }

  const id = getId(meta);
  if (!id) {
    throw new TypeError(`'${entity.name}' must have one field decorated with @Id`);
  }
  meta.id = id;

  return meta;
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
  meta = { entity, name: entity.name, fields: {}, relations: {} };
  metas.set(entity, meta);
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
  return fillRelations(meta);
}

function fillRelations<E>(meta: EntityMeta<E>): EntityMeta<E> {
  for (const relKey in meta.relations) {
    const relOpts = meta.relations[relKey as RelationKey<E>];

    if (relOpts.references) {
      // references were manually specified
      continue;
    }

    if (relOpts.mappedBy) {
      fillInverseSideRelations(relOpts);
      continue;
    }

    const relEntity = relOpts.entity();
    const relMeta = ensureMeta(relEntity);

    if (relOpts.cardinality === 'mm') {
      const idName = meta.fields[meta.id].name;
      const relIdName = relMeta.fields[relMeta.id].name;
      const source = lowerFirst(meta.name) + upperFirst(idName);
      const target = lowerFirst(relMeta.name) + upperFirst(relIdName);
      relOpts.references = [
        { source, target: idName },
        { source: target, target: relIdName },
      ];
    } else {
      relOpts.references = [{ source: `${relKey}Id`, target: relMeta.id }];
    }

    if (relOpts.through) {
      fillThroughRelations(relOpts.through());
    }
  }

  return meta;
}

function fillInverseSideRelations<E>(relOpts: RelationOptions<E>): void {
  const relEntity = relOpts.entity();
  const relMeta = getMeta(relEntity);
  const mappedByKey = getMappedByKey(relOpts);
  relOpts.mappedBy = mappedByKey as RelationMappedBy<E>;

  if (relMeta.relations[mappedByKey as RelationKey<E>]) {
    const { cardinality, references, through } = relMeta.relations[mappedByKey as RelationKey<E>];
    if (cardinality === '11' || cardinality === 'm1') {
      // invert here makes the SQL generation simpler (no need to check for `mappedBy`)
      relOpts.references = references.map(({ source, target }) => ({
        source: target,
        target: source,
      }));
    } else {
      relOpts.references = references;
      relOpts.through = through;
    }
  } else {
    relOpts.references = [{ source: mappedByKey, target: relMeta.id }];
  }
}

function fillThroughRelations<E>(entity: Type<E>): void {
  const meta = ensureMeta(entity);
  meta.relations = getKeys(meta.fields).reduce((relations, key) => {
    const { reference } = meta.fields[key];
    if (reference) {
      const relEntityGetter = (reference as ReferenceOptions).entity;
      const relEntity = relEntityGetter();
      const relMeta = ensureMeta(relEntity);
      const relKey = key.slice(0, -relMeta.id.length);
      const relOpts: RelationOptions = {
        cardinality: 'm1',
        entity: relEntityGetter,
        references: [{ source: key, target: relMeta.id }],
      };
      relations[relKey] = relOpts;
    }
    return relations;
  }, {});
}

function getMappedByKey<E>(relOpts: RelationOptions<E>): Key<E> {
  if (typeof relOpts.mappedBy === 'function') {
    const relEntity = relOpts.entity();
    const relMeta = ensureMeta(relEntity);
    const keyMap = getKeyMap(relMeta);
    const mapper = relOpts.mappedBy as KeyMapper<E>;
    return mapper(keyMap);
  }
  return relOpts.mappedBy as Key<E>;
}

function getKeyMap<E>(meta: EntityMeta<E>): KeyMap<E> {
  return getKeys({ ...meta.fields, ...meta.relations }).reduce((acc, key) => {
    acc[key] = key;
    return acc;
  }, {} as KeyMap<E>);
}

function getId<E>(meta: EntityMeta<E>): FieldKey<E> {
  const id = getKeys(meta.fields).find((key) => meta.fields[key]?.isId);
  return id as FieldKey<E>;
}

function extend<E>(source: EntityMeta<E>, target: EntityMeta<E>): void {
  const sourceFields = { ...source.fields };
  const targetId = getId(target);
  if (targetId) {
    const sourceId = getId(source);
    if (sourceId) {
      delete sourceFields[sourceId];
    }
  }
  target.fields = { ...sourceFields, ...target.fields };
  target.relations = { ...source.relations, ...target.relations };
}

function inferType<E>(entity: Type<E>, key: string): any {
  return Reflect.getMetadata('design:type', entity.prototype, key);
}

function inferEntityType<E>(entity: Type<E>, key: string): Type<any> {
  const inferredType = inferType(entity, key);
  const isValidType = isValidEntityType(inferredType);
  if (!isValidType) {
    throw new TypeError(`'${entity.name}.${key}' type was auto-inferred with invalid type '${inferredType?.name}'`);
  }
  return inferredType;
}

export function isValidEntityType(type: any): type is Type<any> {
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
