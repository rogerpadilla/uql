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
  RelationKeyMap,
  RelationMeta,
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
  // Registration writes the authored shape into a map declared as resolved: `getMeta` runs
  // `fillRelations`, which settles `entity`, `references` and `mappedBy` or throws. Bridging the two
  // shapes here is what lets every consumer read `RelationMeta` without asserting.
  const relations = meta.relations as Record<string, RelationOptions>;
  relations[key] = { ...relations[key], ...opts };
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
    // The authored view: `mappedBy` may still be the callback and `references` unset until this settles them.
    const relOpts: RelationOptions | undefined = meta.relations[relKey];
    if (!relOpts) continue;
    const at = `'${meta.entity.name}.${relKey}'`;

    if (relOpts.mappedBy) {
      fillInverseSide(at, relOpts);
    } else if (!relOpts.references) {
      fillOwningSide(at, meta, relKey, relOpts);
    }
    if (!relOpts.references?.length) {
      throw new TypeError(`${at} has no columns to join on.`);
    }

    // Hand-written `references` land here too: naming the columns says which they are, not that they exist.
    if (relOpts.through) {
      const junction = getMeta(relOpts.through());
      for (const { local } of relOpts.references) {
        if (junction.fields[local]) continue;
        throw new TypeError(
          `${at} joins through '${junction.entity.name}', which has no '${local}' field. Declare it, or name ` +
            "the join columns with 'references'.",
        );
      }
    }
  }
  fillForeignKeyRelations(meta);
  return meta;
}

function fillOwningSide<E>(at: string, meta: EntityMeta<E>, relKey: string, relOpts: RelationOptions): void {
  const relMeta = ensureMeta(relOpts.entity!());
  const relIdKey = relMeta.id;

  if (relOpts.through) {
    // Both columns live on the junction, whatever the cardinality: `fillToManyThroughRelation`,
    // `deleteRelations` and every dialect read them as junction columns.
    relOpts.references = [
      { local: junctionColumn(meta, meta.id), foreign: meta.id },
      { local: junctionColumn(relMeta, relIdKey), foreign: relIdKey },
    ];
    return;
  }

  if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
    throw new TypeError(
      `${at} is a to-many relation with no way to join: it needs 'mappedBy' (the field on the other side), ` +
        "'through' (a junction entity), or 'references' (the columns).",
    );
  }

  const fkKey = `${relKey}Id` as FieldKey<E>;
  relOpts.references = [{ local: fkKey, foreign: relIdKey }];

  // `typeFromReference` so schema generation resolves the referenced primary key's exact type
  // (columnType, length, chained keys) rather than trusting the fallback, as it does for an
  // explicit `@Field({ references })`.
  if (!meta.fields[fkKey]) {
    (meta.fields as Record<string, FieldOptions>)[fkKey] = {
      name: fkKey,
      type: relMeta.fields[relIdKey]?.type ?? Number,
      references: relOpts.entity,
      typeFromReference: true,
    };
  }
}

function fillInverseSide(at: string, relOpts: RelationOptions): void {
  const relEntity = relOpts.entity!();
  const relMeta = getMeta(relEntity);
  const mappedBy = getMappedByKey(relOpts);
  relOpts.mappedBy = mappedBy;
  if (relOpts.references) return;

  if (relMeta.fields[mappedBy]) {
    relOpts.references = [{ local: relMeta.id, foreign: mappedBy }];
    return;
  }

  // Authored view again: with each side mapped by the other, the target is still mid-resolution here and
  // its own `references` are unset, which is what the second throw reports.
  const owner: RelationOptions | undefined = relMeta.relations[mappedBy];
  if (!owner) {
    throw new TypeError(
      `${at} is mapped by '${mappedBy}', which is neither a field nor a relation of '${relEntity.name}'.`,
    );
  }
  if (!owner.references?.length) {
    throw new TypeError(
      `${at} is mapped by '${relEntity.name}.${mappedBy}', an inverse side too, so neither owns the foreign key.`,
    );
  }

  // Two different flips: a junction pair is `[thisSide, otherSide]`, so the array reverses; a plain
  // foreign key is one pair whose ends swap.
  relOpts.references =
    relOpts.cardinality === 'm1' || relOpts.cardinality === 'mm'
      ? owner.references.toReversed()
      : owner.references.map(({ local, foreign }) => ({ local: foreign, foreign: local }));
  relOpts.through = owner.through;
}

/**
 * A field carrying `references` is a foreign key, and a foreign key is a many-to-one whether or not
 * anyone declared the relation. Deriving it everywhere is what lets a junction be written as two plain
 * columns: it needs the relations for `$populate` and for its DDL constraints, and it used to get them
 * only because some *other* entity pointed `through` at it. Gaps only, so a declared relation keeps its
 * own cardinality and `cascade`.
 */
function fillForeignKeyRelations<E>(meta: EntityMeta<E>): void {
  const joined = new Set(
    getKeys(meta.relations).flatMap((key) => meta.relations[key]?.references.map(({ local }) => local) ?? []),
  );
  for (const fieldKey of getKeys(meta.fields)) {
    const references = meta.fields[fieldKey]?.references;
    if (!references || joined.has(fieldKey)) continue;
    const foreign = ensureMeta(references()).id;
    // The relation takes the column's name minus the key it points at (`itemId` -> `item`); a column
    // named anything else has no name to take, so it stays a plain foreign key.
    const suffix = upperFirst(foreign);
    if (!fieldKey.endsWith(suffix)) continue;
    const relKey = fieldKey.slice(0, -suffix.length);
    if (!relKey || meta.fields[relKey] || meta.relations[relKey]) continue;
    (meta.relations as Record<string, RelationMeta>)[relKey] = {
      entity: references,
      cardinality: 'm1',
      references: [{ local: fieldKey, foreign }],
    };
  }
}

/** `<entityName><IdColumn>`, not the `<relationKey>Id` an owning to-one derives: a junction row has no relation key to borrow from. */
function junctionColumn<E>(meta: EntityMeta<E>, idKey: string): string {
  return lowerFirst(meta.name ?? '') + upperFirst(meta.fields[idKey]?.name ?? idKey);
}

/** A callback only reads one property off the key map, and that property is the key, so one serves every entity. */
const RELATION_KEY_MAP = new Proxy({}, { get: (_, key) => key });

function getMappedByKey<E>(relOpts: RelationOptions<E>): Key<E> {
  return typeof relOpts.mappedBy === 'function'
    ? relOpts.mappedBy(RELATION_KEY_MAP as RelationKeyMap<E>)
    : relOpts.mappedBy!;
}

function getIdKey<E>(meta: EntityMeta<E>): IdKey<E> | undefined {
  const id = getKeys(meta.fields).find((key) => meta.fields[key]?.isId);
  return id as IdKey<E> | undefined;
}

function extendMeta<E>(target: EntityMeta<E>, source: EntityMeta<E>): void {
  const sourceFields = { ...source.fields };
  const sourceId = getIdKey(source);
  // A subclass that declares its own primary key drops the parent's, so exactly one stays marked.
  if (sourceId && getIdKey(target)) {
    delete sourceFields[sourceId];
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
