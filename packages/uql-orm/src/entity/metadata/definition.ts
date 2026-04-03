import 'reflect-metadata';
import type {
  EntityIndexMeta,
  EntityMeta,
  EntityOptions,
  FieldKey,
  FieldOptions,
  HookEvent,
  IdKey,
  Key,
  RelationKey,
  RelationKeyMap,
  RelationOptions,
  Type,
} from '../../type/index.js';
import { getKeys, hasKeys, lowerFirst, upperFirst } from '../../util/index.js';
import { LoggerWrapper } from '../../util/logger.js';

type Meta = Map<Type<unknown>, EntityMeta<any>>;
const holder = globalThis as unknown as Record<symbol, Meta>;
const metaKey = Symbol.for('uql-orm/entity/metadata');
const metas: Meta = holder[metaKey] ?? new Map();
holder[metaKey] = metas;

const registrationLogger = new LoggerWrapper(true);

/**
 * Append a composite index entry with normalized `unique` (default false).
 */
export function appendEntityIndex<E>(meta: EntityMeta<E>, index: EntityIndexMeta): void {
  if (!meta.indexes) meta.indexes = [];
  meta.indexes.push({ ...index, unique: index.unique ?? false });
}

export function defineField<E>(entity: Type<E>, key: string, opts: FieldOptions = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (!opts.type) {
    const type = inferType(entity, key);
    opts = { ...opts, type };
  }
  const fieldKey = key as FieldKey<E>;
  meta.fields[fieldKey] = { ...meta.fields[fieldKey], ...{ name: key, ...opts } };
  return meta;
}

export function defineId<E>(entity: Type<E>, key: string, opts: FieldOptions): EntityMeta<E> {
  const meta = ensureMeta(entity);
  const id = getIdKey(meta);
  if (id) {
    registrationLogger.logInfo(`Overriding ID property for '${entity.name}' from '${id}' to '${key}'`);
    delete meta.fields[id];
  }
  return defineField(entity, key, { ...opts, isId: true });
}

export function defineRelation<E>(entity: Type<E>, key: string, opts: RelationOptions<E>): EntityMeta<E> {
  const resolved: RelationOptions<E> = opts.entity
    ? opts
    : (() => {
        const inferredType = inferEntityType(entity, key);
        return { ...opts, entity: () => inferredType };
      })();
  const meta = ensureMeta(entity);
  const relKey = key as RelationKey<E>;
  meta.relations[relKey] = { ...meta.relations[relKey], ...resolved };
  return meta;
}

export function defineHook<E>(entity: Type<E>, methodName: string, event: HookEvent): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (!meta.hooks) meta.hooks = {};
  if (!meta.hooks[event]) meta.hooks[event] = [];
  meta.hooks[event].push({ methodName });
  return meta;
}

function applyBulkFields<E>(entity: Type<E>, fields: Record<string, FieldOptions>): void {
  for (const key of Object.keys(fields)) {
    const spec = fields[key];
    if (!spec) continue;
    if (spec.isId) {
      defineId(entity, key, spec);
    } else {
      defineField(entity, key, spec);
    }
  }
}

function applyBulkRelations<E>(entity: Type<E>, relations: Record<string, RelationOptions<E>>): void {
  for (const key of Object.keys(relations)) {
    const spec = relations[key];
    if (spec) defineRelation(entity, key, spec);
  }
}

function applyBulkIndexes<E>(entity: Type<E>, indexes: readonly EntityIndexMeta[]): void {
  const meta = ensureMeta(entity);
  for (const idx of indexes) {
    appendEntityIndex(meta, idx);
  }
}

function applyBulkHooks<E>(entity: Type<E>, hooks: NonNullable<EntityOptions<E>['hooks']>): void {
  for (const event of Object.keys(hooks) as HookEvent[]) {
    const methodNames = hooks[event];
    if (!methodNames?.length) continue;
    for (const methodName of methodNames) {
      defineHook(entity, methodName, event);
    }
  }
}

/**
 * Applies `fields`, `relations`, `indexes`, and `hooks` from {@link EntityOptions} before
 * entity finalization. Used by `defineEntity` for decorator-free registration.
 */
function applyBulkEntityOptions<E>(entity: Type<E>, opts: EntityOptions<E>): void {
  if (opts.fields) applyBulkFields(entity, opts.fields);
  if (opts.relations) applyBulkRelations(entity, opts.relations);
  if (opts.indexes?.length) applyBulkIndexes(entity, opts.indexes);
  if (opts.hooks) applyBulkHooks(entity, opts.hooks);
}

export function defineEntity<E>(entity: Type<E>, opts: EntityOptions<E> = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);
  applyBulkEntityOptions(entity, opts);

  if (!hasKeys(meta.fields)) {
    throw TypeError(`'${entity.name}' must have fields`);
  }

  const onDeleteKeys = getKeys(meta.fields).filter((key) => meta.fields[key]?.onDelete) as FieldKey<E>[];

  if (onDeleteKeys.length > 1) {
    throw TypeError(`'${entity.name}' must have one field with 'onDelete' as maximum`);
  }

  if (opts.softDelete) {
    if (!onDeleteKeys.length) {
      throw TypeError(`'${entity.name}' must have one field with 'onDelete' to enable 'softDelete'`);
    }
    meta.softDelete = onDeleteKeys[0];
  }

  meta.name = opts.name ?? entity.name;
  let proto: FunctionConstructor = Object.getPrototypeOf(entity.prototype);

  while (proto.constructor !== Object) {
    const parentMeta = ensureMeta(proto.constructor as Type<E>);
    extendMeta(meta, parentMeta);
    proto = Object.getPrototypeOf(proto);
  }

  const id = getIdKey(meta);
  if (!id) {
    throw TypeError(
      `'${entity.name}' must have exactly one id field (use @Id, defineId, or defineEntity({ fields: { ..., isId: true } }))`,
    );
  }
  meta.id = id;

  return meta;
}

export function getEntities(): Type<unknown>[] {
  return [...metas.entries()].reduce((acc, [key, val]) => {
    if (val.id) {
      acc.push(key);
    }
    return acc;
  }, [] as Type<unknown>[]);
}

export function ensureMeta<E>(entity: Type<E>): EntityMeta<E> {
  let meta = metas.get(entity);
  if (meta) {
    return meta;
  }
  meta = { entity, fields: {}, relations: {} };
  metas.set(entity, meta);
  return meta;
}

export function getMeta<E>(entity: Type<E>): EntityMeta<E> {
  const meta = metas.get(entity);
  if (!meta) {
    throw TypeError(`'${entity.name}' is not an entity`);
  }
  if (meta.processed) {
    return meta;
  }
  meta.processed = true;
  return fillRelations(meta);
}

function fillRelations<E>(meta: EntityMeta<E>): EntityMeta<E> {
  for (const relKey in meta.relations) {
    const relOpts = meta.relations[relKey];
    if (!relOpts) continue;

    if (relOpts.references) {
      // references were manually specified
      continue;
    }

    if (relOpts.mappedBy) {
      fillInverseSideRelations(relOpts);
      continue;
    }

    const relEntity = relOpts.entity!();
    const relMeta = ensureMeta(relEntity);

    if (relOpts.cardinality === 'mm') {
      const idKey = meta.id!;
      const relIdKey = relMeta.id!;
      const idName = meta.fields[idKey]?.name ?? idKey;
      const relIdName = relMeta.fields[relIdKey]?.name ?? relIdKey;
      const source = lowerFirst(meta.name ?? '') + upperFirst(idName);
      const target = lowerFirst(relMeta.name ?? '') + upperFirst(relIdName);
      relOpts.references = [
        { local: source, foreign: idKey },
        { local: target, foreign: relIdKey },
      ];
    } else {
      const relIdKey = relMeta.id!;
      relOpts.references = [{ local: `${relKey}Id`, foreign: relIdKey }];
    }

    if (relOpts.through) {
      fillThroughRelations(relOpts.through());
    }
  }

  return meta;
}

function fillInverseSideRelations<E>(relOpts: RelationOptions<E>): void {
  const relEntity = relOpts.entity!();
  const relMeta = getMeta(relEntity);
  const mappedBy = getMappedByRelationKey(relOpts);
  relOpts.mappedBy = mappedBy;

  if (relMeta.fields[mappedBy as FieldKey<any>]) {
    relOpts.references = [{ local: relMeta.id!, foreign: mappedBy }];
    return;
  }

  const mappedByRelation = relMeta.relations[mappedBy as RelationKey<any>];
  if (!mappedByRelation) return;

  if (relOpts.cardinality === 'm1' || relOpts.cardinality === 'mm') {
    relOpts.references = (mappedByRelation.references ?? []).slice().reverse();
    relOpts.through = mappedByRelation.through;
    return;
  }

  relOpts.references = (mappedByRelation.references ?? []).map(({ local, foreign }) => ({
    local: foreign,
    foreign: local,
  }));
}

function fillThroughRelations<E>(entity: Type<E>): void {
  const meta = ensureMeta(entity);
  meta.relations = getKeys(meta.fields).reduce<EntityMeta<E>['relations']>(
    (relations, key) => {
      const field = meta.fields[key];
      if (!field) return relations;
      if (field.references) {
        const relEntity = field.references();
        const relMeta = ensureMeta(relEntity);
        const relIdKey = relMeta.id!;
        const relKey = key.slice(0, -relIdKey.length);
        const relOpts: RelationOptions = {
          entity: field.references,
          cardinality: 'm1',
          references: [{ local: key, foreign: relIdKey }],
        };
        (relations as Record<string, RelationOptions>)[relKey] = relOpts;
      }
      return relations;
    },
    {} as EntityMeta<E>['relations'],
  );
}

function getMappedByRelationKey<E>(relOpts: RelationOptions<E>): Key<E> {
  if (typeof relOpts.mappedBy === 'function') {
    const relEntity = relOpts.entity!();
    const relMeta = ensureMeta(relEntity);
    const keyMap = getRelationKeyMap(relMeta);
    return relOpts.mappedBy(keyMap);
  }
  return relOpts.mappedBy!;
}

function getRelationKeyMap<E>(meta: EntityMeta<E>): RelationKeyMap<E> {
  const keys = [...getKeys(meta.fields), ...getKeys(meta.relations)];
  return keys.reduce(
    (acc, key) => {
      (acc as Record<string, string>)[key] = key;
      return acc;
    },
    {} as RelationKeyMap<E>,
  );
}

function getIdKey<E>(meta: EntityMeta<E>): IdKey<E> {
  const id = getKeys(meta.fields).find((key) => meta.fields[key]?.isId);
  return id as IdKey<E>;
}

function extendMeta<E>(target: EntityMeta<E>, source: EntityMeta<E>): void {
  const sourceFields = { ...source.fields };
  const targetId = getIdKey(target);
  if (targetId) {
    const sourceId = getIdKey(source);
    if (sourceId) {
      delete sourceFields[sourceId];
    }
  }
  target.fields = { ...sourceFields, ...target.fields };
  target.relations = { ...source.relations, ...target.relations };

  // Merge hooks from parent entity (parent hooks execute first)
  if (source.hooks) {
    if (!target.hooks) target.hooks = {};
    for (const event of Object.keys(source.hooks) as HookEvent[]) {
      const sourceList = source.hooks[event];
      if (sourceList?.length) {
        target.hooks[event] = [...sourceList, ...(target.hooks[event] ?? [])];
      }
    }
  }
}

function inferType<E>(entity: Type<E>, key: string): any {
  return Reflect.getMetadata('design:type', entity.prototype, key);
}
function inferEntityType<E>(entity: Type<E>, key: string): Type<any> {
  const inferredType = inferType(entity, key);
  const isValidType = isValidEntityType(inferredType);
  if (!isValidType) {
    throw TypeError(
      `'${entity.name}.${key}' type was auto-inferred with invalid type '${(inferredType as { name?: string })?.name}'`,
    );
  }
  return inferredType;
}

export function isValidEntityType(type: unknown): type is Type<unknown> {
  return (
    typeof type === 'function' &&
    type !== Boolean &&
    type !== String &&
    type !== Number &&
    type !== BigInt &&
    type !== Date &&
    type !== Symbol
  );
}
