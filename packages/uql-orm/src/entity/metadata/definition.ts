import type {
  EntityIndexInput,
  EntityMeta,
  EntityOptions,
  FieldKey,
  FieldOptions,
  FilterOptions,
  HookEvent,
  IdKey,
  Key,
  QueryWhere,
  RelationKey,
  RelationKeyMap,
  RelationOptions,
  Type,
} from '../../type/index.js';
import { getKeys, hasKeys, lowerFirst, normalizeIndexColumn, upperFirst } from '../../util/index.js';
import { ownRegistrations } from '../decorator/bag.js';

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry - stores EntityMeta for all entity types
type Meta = Map<Type<unknown>, EntityMeta<any>>;
// Held on `globalThis` via the global symbol registry so a single metadata map survives multiple
// evaluations of this module (HMR, duplicated/federated bundles, ESM+CJS dual-loading). Version-suffixed
// because v1 changed the `FieldOptions` shape: a tree holding both majors gets two maps rather than one
// map with entries the other major cannot read.
const holder = globalThis as unknown as Record<symbol, Meta>;
const metaKey = Symbol.for('uql-orm/entity/metadata/v1');
const metas: Meta = holder[metaKey] ?? new Map();
holder[metaKey] = metas;

export function defineField<E>(entity: Type<E>, key: string, opts: FieldOptions = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (!opts.type && !opts.references && !opts.virtual) {
    throw new TypeError(
      `'${entity.name}.${key}' needs a 'type'. Declare it - '@Field({ type: String })' - or point the field ` +
        "at another entity with 'references', which resolves the column type from its primary key.",
    );
  }
  const fieldKey = key as FieldKey<E>;
  // Flagged when the author gave `references` but no `type`, so schema generation knows to resolve the
  // column from the referenced primary key (picking up its `columnType`, length and chained keys)
  // instead of treating whatever ends up in `type` as deliberate.
  const resolved = opts.type ? opts : { ...opts, typeFromReference: true as const };
  meta.fields[fieldKey] = { ...meta.fields[fieldKey], ...{ name: key, ...resolved } };
  return meta;
}

export function defineId<E>(entity: Type<E>, key: string, opts: FieldOptions): EntityMeta<E> {
  const meta = ensureMeta(entity);
  const id = getIdKey(meta);
  if (id) {
    // A subclass narrowing the inherited primary key: drop the old one so exactly one stays marked.
    delete meta.fields[id];
  }
  return defineField(entity, key, { ...opts, isId: true });
}

// `RelationOptions` is parameterized by the *target* entity, which is independent of the owner `E`, so it
// is left at its default here rather than tied to the class being registered.
export function defineRelation<E>(entity: Type<E>, key: string, opts: RelationOptions): EntityMeta<E> {
  if (!opts.entity) {
    throw new TypeError(
      `'${entity.name}.${key}' needs an 'entity' getter, e.g. '@ManyToOne({ entity: () => Company })'.`,
    );
  }
  const meta = ensureMeta(entity);
  const relKey = key as RelationKey<E>;
  meta.relations[relKey] = { ...meta.relations[relKey], ...opts };
  return meta;
}

export function defineHook<E>(entity: Type<E>, methodName: string, event: HookEvent): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (!meta.hooks) meta.hooks = {};
  if (!meta.hooks[event]) meta.hooks[event] = [];
  meta.hooks[event].push({ methodName });
  return meta;
}

/**
 * Declares a composite index. `unique` and the authored column sugar are normalized here, which is what
 * lets the dialects render one shape instead of re-parsing it.
 */
export function defineIndex<E>(entity: Type<E>, index: EntityIndexInput<FieldKey<E>>): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (!meta.indexes) meta.indexes = [];
  meta.indexes.push({ ...index, unique: index.unique ?? false, columns: index.columns.map(normalizeIndexColumn) });
  return meta;
}

export function defineFilter<E>(entity: Type<E>, name: string, opts: FilterOptions<E>): EntityMeta<E> {
  const meta = ensureMeta(entity);
  if (name === 'softDelete') {
    throw TypeError(
      `'${entity.name}' filter name 'softDelete' is reserved; it is auto-registered from @Field({ softDelete })`,
    );
  }
  if (opts.security && opts.onMissing === 'skip') {
    throw TypeError(`'${entity.name}' security filter '${name}' cannot use onMissing: 'skip' (it must fail closed)`);
  }
  if (!meta.filters) meta.filters = {};
  meta.filters[name] = opts;
  return meta;
}

/**
 * What a decorator bag and {@link EntityOptions} have in common at registration time. The keyed mapped
 * types in `EntityOptions<E>` are what check the imperative call; a member decorator has no class to key
 * against, so by the time either reaches the primitives the keys are plain strings.
 */
type MemberSpecs = {
  readonly fields?: Readonly<Record<string, FieldOptions | undefined>>;
  readonly relations?: Readonly<Record<string, RelationOptions | undefined>>;
  readonly hooks?: Readonly<Partial<Record<HookEvent, readonly string[]>>>;
};

/**
 * Feeds fields, relations and hooks into the `define*` primitives, so the decorators and the imperative
 * API converge on one registration path before anything is finalized.
 */
export function applyMembers<E>(entity: Type<E>, specs: MemberSpecs | undefined): void {
  for (const [key, spec] of Object.entries(specs?.fields ?? {})) {
    if (!spec) continue;
    if (spec.isId) {
      defineId(entity, key, spec);
    } else {
      defineField(entity, key, spec);
    }
  }
  for (const [key, spec] of Object.entries(specs?.relations ?? {})) {
    if (spec) defineRelation(entity, key, spec);
  }
  for (const [event, methodNames] of Object.entries(specs?.hooks ?? {})) {
    for (const methodName of methodNames ?? []) {
      defineHook(entity, methodName, event as HookEvent);
    }
  }
}

export function defineEntity<E>(entity: Type<E>, opts: EntityOptions<E> = {}): EntityMeta<E> {
  const meta = ensureMeta(entity);
  // Covers `defineEntity(Decorated)` called on a class whose members carry decorators. `@Entity()`
  // drains `context.metadata` itself, because TypeScript only attaches `Symbol.metadata` to the class
  // after class decorators return; draining empties the bag, so whichever runs second is a no-op.
  applyMembers(entity, ownRegistrations(entity));
  applyMembers(entity, opts);
  for (const index of opts.indexes ?? []) {
    defineIndex(entity, index);
  }
  for (const [name, spec] of Object.entries(opts.filters ?? {})) {
    if (spec) defineFilter(entity, name, spec);
  }

  if (!hasKeys(meta.fields)) {
    throw TypeError(`'${entity.name}' must have fields`);
  }

  meta.name = opts.name ?? entity.name;
  let proto: FunctionConstructor = Object.getPrototypeOf(entity.prototype);

  while (proto.constructor !== Object) {
    const parent = proto.constructor as Type<E>;
    // An `abstract class BaseEntity` carrying `@Field`s but no `@Entity()` has nobody to drain its
    // registrations, so do it here. Walking the *class* prototype chain rather than reading through the
    // metadata object's is what makes this work on every transformer: tsc and esbuild chain metadata
    // across `extends`, SWC does not.
    applyMembers(parent, ownRegistrations(parent));
    extendMeta(meta, ensureMeta(parent));
    proto = Object.getPrototypeOf(proto);
  }

  // Derive soft-delete from the (inheritance-merged) fields, so own and inherited markers are handled
  // uniformly. Exactly one field may be marked; it auto-registers the built-in `softDelete` read
  // filter (a reserved name - see defineFilter - so it never clobbers a user filter).
  const softDeleteKeys = getKeys(meta.fields).filter((key) => {
    const softDelete = meta.fields[key]?.softDelete;
    return softDelete !== undefined && softDelete !== false;
  }) as FieldKey<E>[];
  if (softDeleteKeys.length > 1) {
    throw TypeError(`'${entity.name}' must have at most one field with 'softDelete'`);
  }
  if (softDeleteKeys.length) {
    meta.softDelete = softDeleteKeys[0];
    if (!meta.filters) meta.filters = {};
    meta.filters['softDelete'] = { condition: { [meta.softDelete]: null } as QueryWhere<E>, default: true };
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
  meta = { entity, id: '', fields: {}, relations: {} };
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
      fillInverseSideRelations(meta, relKey, relOpts);
      continue;
    }

    const relEntity = relOpts.entity!();
    const relMeta = ensureMeta(relEntity);
    const relIdKey = relMeta.id;

    if (relOpts.through) {
      // Both columns live on the junction, whatever the cardinality: `fillToManyThroughRelation`,
      // `deleteRelations` and every dialect read them as junction columns.
      const idKey = meta.id;
      const idName = meta.fields[idKey]?.name ?? idKey;
      const relIdName = relMeta.fields[relIdKey]?.name ?? relIdKey;
      relOpts.references = [
        { local: lowerFirst(meta.name ?? '') + upperFirst(idName), foreign: idKey },
        { local: lowerFirst(relMeta.name ?? '') + upperFirst(relIdName), foreign: relIdKey },
      ];

      const throughEntity = relOpts.through();
      const throughMeta = fillThroughRelations(throughEntity);
      for (const { local } of relOpts.references) {
        if (throughMeta.fields[local]) continue;
        throw new TypeError(
          `'${meta.entity.name}.${relKey}' joins through '${throughEntity.name}', which has no '${local}' ` +
            "field. Declare it, or name the join columns with 'references'.",
        );
      }
      continue;
    }

    // A to-many owner reaches its children through a junction, and nothing else here can reach them:
    // `mappedBy` and hand-written `references`, both handled above, are the other two ways to say how.
    if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
      throw new TypeError(
        `'${meta.entity.name}.${relKey}' is a to-many relation with no way to join: it needs 'mappedBy' ` +
          "(the field on the other side), 'through' (a junction entity), or 'references' (the columns).",
      );
    }

    const fkKey = `${relKey}Id` as FieldKey<E>;
    relOpts.references = [{ local: fkKey, foreign: relIdKey }];

    // Auto-create the FK column when only the relation is declared (no explicit `@Field`).
    // Mirror an explicit `@Field({ references })` column: carry `references` and mark the type
    // as inferred so schema generation resolves the exact referenced primary-key type
    // (columnType, length, chained keys) via `resolveColumnCanonicalType`.
    if (!meta.fields[fkKey]) {
      const relatedIdField = relMeta.fields[relIdKey];
      meta.fields[fkKey] = {
        ...meta.fields[fkKey],
        name: fkKey,
        type: relatedIdField?.type ?? Number,
        references: relOpts.entity,
        typeFromReference: true,
      };
    }
  }

  return meta;
}

function fillInverseSideRelations<O, E>(meta: EntityMeta<O>, relKey: string, relOpts: RelationOptions<E>): void {
  const relEntity = relOpts.entity!();
  const relMeta = getMeta(relEntity);
  const mappedBy = getMappedByRelationKey(relOpts);
  relOpts.mappedBy = mappedBy;

  if (relMeta.fields[mappedBy]) {
    relOpts.references = [{ local: relMeta.id, foreign: mappedBy }];
    return;
  }

  const mappedByRelation = relMeta.relations[mappedBy];
  if (!mappedByRelation) {
    throw new TypeError(
      `'${meta.entity.name}.${relKey}' is mapped by '${mappedBy}', which is neither a field nor a relation of ` +
        `'${relEntity.name}'.`,
    );
  }

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

// `getMeta` rather than `ensureMeta`: a pivot that declares its sides as relations rather than as
// `@Field({ references })` columns gets those foreign-key columns auto-created there, and the caller
// checks its own derived join columns against them.
function fillThroughRelations<E>(entity: Type<E>): EntityMeta<E> {
  const meta = getMeta(entity);
  meta.relations = getKeys(meta.fields).reduce<EntityMeta<E>['relations']>(
    (relations, key) => {
      const field = meta.fields[key];
      if (!field) return relations;
      if (field.references) {
        const relEntity = field.references();
        const relMeta = ensureMeta(relEntity);
        const relIdKey = relMeta.id;
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
  return meta;
}

function getMappedByRelationKey<E>(relOpts: RelationOptions<E>): Key<E> {
  if (typeof relOpts.mappedBy === 'function') {
    const relEntity = relOpts.entity!();
    // `getMeta`: the caller has already resolved the target, and its auto-created foreign-key columns
    // are keys the callback is entitled to name.
    const relMeta = getMeta(relEntity);
    const keyMap = getRelationKeyMap(relMeta);
    return relOpts.mappedBy(keyMap);
  }
  return relOpts.mappedBy!;
}

function getRelationKeyMap<E>(meta: EntityMeta<E>): RelationKeyMap<E> {
  const keys = [...getKeys(meta.fields), ...getKeys(meta.relations)];
  return Object.fromEntries(keys.map((key) => [key, key])) as RelationKeyMap<E>;
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

  // Inherit user-defined filters from the parent (child overrides by name). The built-in soft-delete
  // filter + `meta.softDelete` are (re)derived from the merged fields in `defineEntity`.
  if (source.filters) {
    target.filters = { ...source.filters, ...target.filters };
  }

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
