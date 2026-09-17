import type {
  EntityData,
  EntityGetter,
  EntityIndexInput,
  EntityMembers,
  EntityMeta,
  EntityOptions,
  FieldKey,
  FieldMeta,
  FieldOptions,
  FilterName,
  FilterOnMissing,
  FilterOptions,
  HookEvent,
  IdKey,
  KeyMap,
  QueryWhere,
  RelationKey,
  RelationMeta,
  RelationOptions,
  RelationReferences,
  RelationRegistration,
  Type,
  WrittenId,
} from '../../type/index.js';
import { SOFT_DELETE_FILTER } from '../../type/index.js';
import { isInlinedExpression } from '../../util/field.util.js';
import {
  entitySql,
  entityWhere,
  fieldOptionConflict,
  getKeys,
  hasKeys,
  isToManyRelation,
  memberRefs,
  normalizeIndexColumn,
  definedEntries,
} from '../../util/index.js';
import { ownRegistrations } from '../decorator/bag.js';

// oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous registry - stores EntityMeta for all entity types
type Meta = Map<Type<unknown>, EntityMeta<any>>;
/**
 * A map held on `globalThis` through the global symbol registry, so a single one survives multiple
 * evaluations of this module (HMR, duplicated/federated bundles, ESM+CJS dual-loading). The keys are
 * version-suffixed because v1 changed the `FieldOptions` shape: a tree holding both majors gets two
 * maps rather than one map with entries the other major cannot read.
 */
function globalMap<K, V>(key: string): Map<K, V> {
  const holder = globalThis as unknown as Record<symbol, Map<K, V>>;
  const symbol = Symbol.for(key);
  holder[symbol] ??= new Map();
  return holder[symbol];
}

const metas: Meta = globalMap('uql-orm/entity/metadata/v1');

export function defineField<E>(entity: Type<E>, key: string, opts: FieldOptions = {}): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  // A stored computed column is a real column and still needs a type; only an inlined one is exempt,
  // its expression being spliced in rather than declared.
  if (!opts.type && !opts.references && !isInlinedExpression(opts)) {
    throw new TypeError(
      `'${entity.name}.${key}' needs a 'type'. Declare it - '@Field({ type: String })' - or point the field ` +
        "at another entity with 'references', which resolves the column type from its primary key.",
    );
  }
  const conflict = fieldOptionConflict(opts);
  if (conflict) {
    throw new TypeError(`'${entity.name}.${key}' ${conflict}.`);
  }
  const fieldKey = key as FieldKey<E>;
  // Flagged when the author gave `references` but no `type`, so schema generation knows to resolve the
  // column from the referenced primary key (picking up its `columnType`, length and chained keys)
  // instead of treating whatever ends up in `type` as deliberate.
  const { computed, ...rest } = opts;
  const resolved = rest.type ? rest : { ...rest, typeFromReference: true as const };
  meta.fields[fieldKey] = {
    ...meta.fields[fieldKey],
    name: key,
    ...resolved,
    ...(computed && { computed: entitySql(computed) }),
  };
  return meta;
}

export function defineId<E>(entity: Type<E>, key: string, opts: FieldOptions): EntityMeta<E> {
  return defineField(entity, key, { ...opts, isId: true });
}

/** `T` is the relation's target, independent of the owner `E`. */
export function defineRelation<E, T extends object>(
  entity: Type<E>,
  key: string,
  opts: RelationOptions<T, E>,
): EntityMeta<E> {
  return addRelation(entity, key, relationRegistration(opts));
}

/**
 * `opts` as the registry takes them: `mappedBy` and `references` read off their key maps down to the
 * names they give. The callbacks only read properties, so they run here, before any entity has to
 * exist, and the registry holds data alone.
 */
export function relationRegistration<T extends object, O>({
  mappedBy,
  references,
  ...opts
}: RelationOptions<T, O>): RelationRegistration {
  const joined = references?.(keyMap<O>(), keyMap<T>());
  return {
    ...opts,
    ...(mappedBy && { mappedBy: mappedBy(keyMap<T>()) }),
    ...(joined && { references: typeof joined === 'string' ? joined : [...joined] }),
  };
}

/** Every entity's key map: a callback only reads one property off it, and that property is its own key. */
function keyMap<E>(): KeyMap<E> {
  return KEY_MAP as KeyMap<E>;
}

const KEY_MAP = new Proxy({}, { get: (_, key) => key });

function addRelation<E>(entity: Type<E>, key: string, registration: RelationRegistration): EntityMeta<E> {
  if (!registration.entity) {
    throw new TypeError(
      `'${entity.name}.${key}' needs an 'entity' getter, e.g. '@ManyToOne({ entity: () => Company })'.`,
    );
  }
  if (registration.through && registration.references) {
    throw new TypeError(
      `'${entity.name}.${key}' joins through a junction, whose column referencing each side is the join; ` +
        "'references' pairs the declaring entity's columns with the target's instead.",
    );
  }
  const meta = ensureWritableMeta(entity);
  // Registration writes into a map declared as resolved: `getMeta` runs `fillRelations`, which settles
  // `references` or throws. Bridging the two shapes here is what lets every consumer read `RelationMeta`
  // without asserting.
  const relations = meta.relations as Record<string, RelationRegistration>;
  relations[key] = { ...relations[key], ...registration };
  return meta;
}

export function defineHook<E>(entity: Type<E>, methodName: string, event: HookEvent): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  ((meta.hooks ??= {})[event] ??= []).push({ methodName });
  return meta;
}

/**
 * Declares a composite index, its columns read off the entity's refs. `unique` and the authored column
 * sugar are normalized here, which is what lets the dialects render one shape instead of re-parsing it.
 */
export function defineIndex<E>(entity: Type<E>, index: EntityIndexInput<E>): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  const refs = memberRefs<E>();
  (meta.indexes ??= []).push({
    ...index,
    unique: index.unique ?? false,
    where: index.where && entityWhere(index.where),
    columns: index.columns(refs).map(normalizeIndexColumn),
    include: index.include?.(refs).map((ref) => ref.key),
  });
  return meta;
}

export function defineFilter<E, N extends string>(
  entity: Type<E>,
  name: FilterName<N>,
  opts: FilterOptions<E>,
): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  if (name === SOFT_DELETE_FILTER) {
    throw TypeError(
      `'${entity.name}' filter name '${SOFT_DELETE_FILTER}' is reserved; it is auto-registered from @Field({ softDelete })`,
    );
  }
  // Widened for a caller the types did not reach, which is the only one this can refuse.
  const { security, onMissing }: { readonly security?: boolean; readonly onMissing?: FilterOnMissing } = opts;
  if (security && onMissing === 'skip') {
    throw TypeError(`'${entity.name}' security filter '${name}' cannot use onMissing: 'skip' (it must fail closed)`);
  }
  (meta.filters ??= {})[name] = opts;
  return meta;
}

/**
 * Feeds fields, relations and hooks into the `define*` primitives, so the decorators and the imperative
 * API converge on one registration path before anything is finalized.
 */
export function applyMembers<E>(entity: Type<E>, specs: EntityMembers | undefined): void {
  for (const [key, spec] of definedEntries(specs?.fields ?? {})) {
    if (spec.isId) {
      defineId(entity, key, spec);
    } else {
      defineField(entity, key, spec);
    }
  }
  for (const [key, spec] of definedEntries(specs?.relations ?? {})) {
    addRelation(entity, key, spec);
  }
  for (const [event, methodNames] of definedEntries(specs?.hooks ?? {})) {
    for (const methodName of methodNames) {
      defineHook(entity, methodName, event);
    }
  }
}

/**
 * Registers a class as an entity from `opts` alone, the decorator-free counterpart of `@Entity()` with
 * `@Field`/`@ManyToOne`/...
 */
export function defineEntity<E>(entity: Type<E>, opts: EntityOptions<E> = {}): EntityMeta<E> {
  // Ahead of any registration, so a rejected definition leaves nothing half-written in the registry.
  // A dotted name reads like a schema and is not one: it escapes as a single identifier, so the
  // statement builds and then fails at the database. `schema` is the way to say it.
  if (opts.name?.includes('.')) {
    const [schema, ...rest] = opts.name.split('.');
    throw new TypeError(
      `'${entity.name}' has a dotted name '${opts.name}'. Name the schema separately as ` +
        `{ schema: '${schema}', name: '${rest.join('.')}' }.`,
    );
  }

  const meta = ensureWritableMeta(entity);
  // Covers `defineEntity(Decorated)` called on a class whose members carry decorators. `@Entity()`
  // drains `context.metadata` itself, because TypeScript only attaches `Symbol.metadata` to the class
  // after class decorators return; draining empties the bag, so whichever runs second is a no-op.
  applyMembers(entity, ownRegistrations(entity));
  const keys = keyMap<E>();
  applyMembers(entity, {
    fields: opts.fields,
    relations: Object.fromEntries(
      definedEntries(opts.relations ?? {}).map(([key, spec]) => [key, relationRegistration(spec)]),
    ),
    hooks: Object.fromEntries(definedEntries(opts.hooks ?? {}).map(([event, methods]) => [event, methods(keys)])),
  });
  // Unnamed checks are named by the generator, as unnamed indexes are.
  for (const check of opts.checks ?? []) {
    (meta.checks ??= []).push({ name: check.name, where: entityWhere(check.where) });
  }
  for (const index of opts.indexes ?? []) {
    defineIndex(entity, index);
  }
  for (const [name, filter] of definedEntries(opts.filters ?? {})) {
    defineFilter(entity, name, filter);
  }

  if (!hasKeys(meta.fields)) {
    throw TypeError(`'${entity.name}' must have fields`);
  }

  // A later call composes onto the entity, so a name is only ever set, and `derivedName` records that
  // the class name stood in, which is what a naming strategy derives from.
  if (opts.name !== undefined) {
    meta.name = opts.name;
    meta.derivedName = false;
  } else if (meta.name === undefined) {
    meta.name = entity.name;
    meta.derivedName = true;
  }
  meta.schema = opts.schema ?? meta.schema;
  // The class's real chain first: where a class both extends a base and names one, the one it extends
  // is the nearer, and nearer wins every merge.
  inheritFrom(meta, parentOf(entity));
  inheritFrom(meta, opts.extends);

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
    (meta.filters ??= {})[SOFT_DELETE_FILTER] = { where: { [meta.softDelete]: null } as QueryWhere<E>, default: true };
  }

  const ids = getIdKeys(meta);
  if (!ids.length) {
    throw TypeError(
      `'${entity.name}' must have at least one id field (use @Id, defineId, or defineEntity({ fields: { ..., isId: true } }))`,
    );
  }
  meta.ids = ids;

  return meta;
}

/**
 * Refuses an entity whose primary key is not one column, naming the path that cannot express it.
 *
 * Refusing rather than taking the first of several is the whole guarantee: pairing one column of a
 * two-column key is how a statement silently addresses rows that merely agree on it.
 */
export function assertSoleId<E>(meta: EntityMeta<E>, what: string): void {
  const { ids } = meta;
  if (ids.length === 1) {
    return;
  }
  throw new TypeError(
    ids.length
      ? `'${meta.entity.name}' has a composite primary key (${ids.join(', ')}), which ${what} does not support yet.`
      : // An entity registered with `@Field` but no `@Entity` never ran the check in `defineEntity`.
        `'${meta.entity.name}' has no primary key, which ${what} needs.`,
  );
}

/** The entity's one primary key, for a path that cannot express a composite. See {@link assertSoleId}. */
export function soleIdOf<E>(meta: EntityMeta<E>, what: string): IdKey<E> {
  assertSoleId(meta, what);
  return meta.ids[0];
}

/** The field `key` names, for a caller that took `key` from the metadata itself. */
export function fieldOf<E>(meta: EntityMeta<E>, key: string): FieldMeta {
  const field = meta.fields[key];
  if (!field) {
    throw new TypeError(`'${meta.entity.name}' has no field '${key}'`);
  }
  return field;
}

/** The relation `key` names, for a caller that took `key` from the metadata itself. */
export function relationOf<E>(meta: EntityMeta<E>, key: RelationKey<E>): RelationMeta {
  const relation = meta.relations[key];
  if (!relation) {
    throw new TypeError(`'${meta.entity.name}' has no relation '${key}'`);
  }
  return relation;
}

/** Whether the row names every column of its primary key, `0` and `''` included. */
export function namesKey<E>(meta: EntityMeta<E>, row: EntityData<E>): boolean {
  return meta.ids.every((key) => row[key] != null);
}

/** A row's primary key: its value, or a map of every column on a composite, checked at run time. */
export function idOf<E>(meta: EntityMeta<E>, row: EntityData<E>): WrittenId<E> {
  const { ids } = meta;
  const id = ids.length === 1 ? row[ids[0]] : Object.fromEntries(ids.map((key) => [key, row[key]]));
  return id as WrittenId<E>;
}

/**
 * Forgets an entity, and reports whether there was one - for a registry that grows at runtime, where a
 * deleted content type would otherwise keep its metadata for the life of the process. Nothing rewrites
 * what pointed at it, and a decorated class does not come back (its decorators drained at first
 * registration). See the Runtime Schemas guide.
 */
export function removeEntity<E>(entity: Type<E>): boolean {
  return metas.delete(entity);
}

export function getEntities(): Type<object>[] {
  return [...metas.values()].filter((meta) => meta.ids.length).map((meta) => meta.entity);
}

/**
 * The metadata of `entity`, marked as changed. Every `define*` goes through this, and nothing outside
 * this file writes to a meta, so it is the one place a derived cache can be told it has gone stale.
 */
function ensureWritableMeta<E>(entity: Type<E>): EntityMeta<E> {
  const meta = ensureMeta(entity);
  meta.revision++;
  return meta;
}

function ensureMeta<E>(entity: Type<E>): EntityMeta<E> {
  let meta = metas.get(entity);
  if (meta) {
    return meta;
  }
  meta = { entity, ids: [], fields: {}, relations: {}, revision: 0 };
  metas.set(entity, meta);
  return meta;
}

export function getMeta<E>(entity: Type<E>): EntityMeta<E> {
  const meta = registeredMeta(entity);
  // Stamped once finalizing succeeds, so a read after a failure reports the same mistake again. Finalizing
  // reads other entities without resolving them, so no entity is ever read half resolved.
  if (meta.processedAt !== meta.revision) {
    fillRelations(meta);
    meta.processedAt = meta.revision;
  }
  return meta;
}

/** The metadata `entity` registered, however much of it is resolved. */
function registeredMeta<E>(entity: Type<E>): EntityMeta<E> {
  const meta = metas.get(entity);
  if (!meta) {
    throw TypeError(`'${entity.name}' is not an entity`);
  }
  return meta;
}

function fillRelations<E>(meta: EntityMeta<E>): void {
  for (const [relKey, relation] of definedEntries(meta.relations)) {
    const at = `'${meta.entity.name}.${relKey}'`;
    const references = settledReferences(at, meta, relKey, relation);
    if (!references.length) {
      throw new TypeError(`${at} has no columns to join on.`);
    }
    if (!relation.through) {
      assertJoins(at, meta, relation, references);
    }
  }
  // A column `references` names is a foreign key with or without a relation over it, and one cannot point
  // at a composite key: refused on first read, as a relation that cannot join is, not at the schema build.
  foreignKeysOf(meta);
}

/**
 * The pairs a relation joins on, settled on first read, whether its own entity is being resolved or another
 * needs it. Never resolving an entity is what keeps it from recursing, and the one column a to-one names is
 * paired with its target's key only here, since registration can run before the target has one.
 */
function settledReferences<E>(
  at: string,
  meta: EntityMeta<E>,
  relKey: string,
  relOpts: RelationRegistration,
): RelationReferences {
  const { references, mappedBy, through } = relOpts;
  if (typeof references === 'string') {
    const target = ensureMeta(relOpts.entity());
    if (mappedBy || isToManyRelation(relOpts) || target.ids.length > 1) {
      throw new TypeError(
        `${at} names one column, '${references}', which only a to-one holding a foreign key to a one-column key ` +
          'can: pair the columns, [{ local, foreign }].',
      );
    }
    relOpts.references = [{ local: references, foreign: soleIdOf(target, 'a foreign key') }];
    return relOpts.references;
  }
  if (references) return references;
  if (mappedBy) return fillInverseSide(at, meta, relOpts, mappedBy);
  if (through) return fillThrough(at, meta, relOpts, through);
  throw new TypeError(
    isToManyRelation(relOpts)
      ? `${at} is a to-many relation with no way to join: it needs 'mappedBy' (the member on the other side), ` +
          "'through' (a junction entity), or 'references' (the columns)."
      : `${at} needs 'references', the foreign key column it joins by, or 'mappedBy', the member on the other ` +
          'side holding it.',
  );
}

/**
 * Each key of this entity, then each of the target, paired with the junction's one column referencing it.
 * Both groups live on the junction whatever the cardinality, as `deleteRelations` and every dialect read
 * them, and a composite key gives a pair per column, which is what makes a join address a whole key.
 */
function fillThrough<E>(
  at: string,
  meta: EntityMeta<E>,
  relOpts: RelationRegistration,
  through: EntityGetter,
): RelationReferences {
  const junction = registeredMeta(through());
  relOpts.references = [
    ...junctionReferences(at, junction, meta),
    ...junctionReferences(at, junction, ensureMeta(relOpts.entity())),
  ];
  return relOpts.references;
}

function fillInverseSide<E>(
  at: string,
  meta: EntityMeta<E>,
  relOpts: RelationRegistration,
  mappedBy: string,
): RelationReferences {
  const relMeta = registeredMeta(relOpts.entity());
  const other = `'${relMeta.entity.name}.${mappedBy}'`;

  if (relMeta.fields[mappedBy]) {
    if (meta.ids.length > 1) {
      throw new TypeError(
        `${at} is mapped by ${other}, one column, but the primary key of ` +
          `'${meta.entity.name}' is composite (${meta.ids.join(', ')}). Map it by the relation on the other side ` +
          'instead, which joins every column of the key.',
      );
    }
    // `local` is this entity's own key, as in every other pair.
    relOpts.references = [{ local: meta.ids[0], foreign: mappedBy }];
    return relOpts.references;
  }

  const owner: RelationRegistration | undefined = relMeta.relations[mappedBy];
  if (!owner) {
    throw new TypeError(
      `${at} is mapped by '${mappedBy}', which is neither a field nor a relation of '${relMeta.entity.name}'.`,
    );
  }
  if (owner.mappedBy) {
    throw new TypeError(`${at} is mapped by ${other}, an inverse side too, so neither owns the foreign key.`);
  }
  const ownerTarget = owner.entity();
  if (!isA(meta.entity, ownerTarget)) {
    throw new TypeError(
      `${at} is mapped by ${other}, a relation to '${ownerTarget.name}', not to '${meta.entity.name}'.`,
    );
  }
  const ownerReferences = settledReferences(other, relMeta, mappedBy, owner);

  // Two different flips: a junction's pairs are the owner's group followed by ours, so the two groups
  // swap - `toReversed` would also reverse each group, pairing a composite's columns crosswise. A
  // plain foreign key is one pair per key whose ends swap.
  relOpts.references =
    relOpts.cardinality === 'm1' || relOpts.cardinality === 'mm'
      ? [...ownerReferences.slice(relMeta.ids.length), ...ownerReferences.slice(0, relMeta.ids.length)]
      : ownerReferences.map(({ local, foreign }) => ({ local: foreign, foreign: local }));
  relOpts.through = owner.through;
  return relOpts.references;
}

/**
 * Refuses a join on a column either entity does not store, and a one-column join whose foreign key, on
 * whichever side holds it, points at another entity: it would match unrelated rows by their keys.
 */
function assertJoins<E>(
  at: string,
  meta: EntityMeta<E>,
  relOpts: RelationRegistration,
  pairs: RelationReferences,
): void {
  const target = registeredMeta(relOpts.entity());
  // Only the owning side of a to-one holds its foreign key; an inverse side and a to-many join on the target's.
  const holdsLocally = !relOpts.mappedBy && !isToManyRelation(relOpts);
  const sides = [
    { meta: columnsOf(meta), keys: pairs.map(({ local }) => local), joins: target.entity, holds: holdsLocally },
    { meta: columnsOf(target), keys: pairs.map(({ foreign }) => foreign), joins: meta.entity, holds: !holdsLocally },
  ];
  for (const side of sides) {
    for (const key of side.keys) {
      const column = `'${side.meta.entity.name}.${key}'`;
      const field = side.meta.fields[key];
      if (!field || isInlinedExpression(field)) {
        throw new TypeError(`${at} joins ${column}, which is not a column: declare it with '@Field'.`);
      }
      const referenced = side.holds && pairs.length === 1 ? field.references?.() : undefined;
      if (referenced && !isA(side.joins, referenced)) {
        throw new TypeError(
          `${at} joins ${column}, a foreign key to '${referenced.name}', not to '${side.joins.name}'.`,
        );
      }
    }
  }
}

/** `meta` with its fields read by any name, as a join's columns come. */
function columnsOf<E>(meta: EntityMeta<E>): { entity: Type<E>; fields: Record<string, FieldMeta | undefined> } {
  return meta;
}

/** Whether `entity` is `base` or extends it, as an entity inheriting a relation does. */
function isA(entity: Type<unknown>, base: Type<unknown>): boolean {
  return entity === base || entity.prototype instanceof base;
}

/**
 * The foreign keys an entity holds: each owning to-one's columns, and each `@Field({ references })` no
 * relation joins on, as the many-to-one it describes, once its target has registered a key. What the
 * schema build constrains and a junction joins by, settling the relations holding them first.
 */
export function foreignKeysOf<E>(meta: EntityMeta<E>): RelationMeta[] {
  const owning = definedEntries(meta.relations)
    .filter(([, relation]) => !relation.mappedBy && !relation.through && !isToManyRelation(relation))
    .map(([relKey, relation]) => {
      settledReferences(`'${meta.entity.name}.${relKey}'`, meta, relKey, relation);
      return relation;
    });
  const joined = new Set(owning.flatMap(({ references }) => references.map(({ local }) => local)));
  const columns = definedEntries(meta.fields).flatMap(([key, field]): RelationMeta[] => {
    if (!field.references || joined.has(key)) return [];
    const target = ensureMeta(field.references());
    if (!target.ids.length) return [];
    if (target.ids.length > 1) {
      throw new TypeError(
        `'${meta.entity.name}.${key}' cannot reference '${target.entity.name}', whose primary key is composite ` +
          `(${target.ids.join(', ')}): a column points at one. Declare a column per key and pair each with it ` +
          `in a '@ManyToOne' to '${target.entity.name}'.`,
      );
    }
    return [{ entity: field.references, cardinality: 'm1', references: [{ local: key, foreign: target.ids[0] }] }];
  });
  return [...owning, ...columns];
}

/** Each key of `side`, paired with the one column of `junction` referencing it: a rename of either follows. */
function junctionReferences<S>(at: string, junction: EntityMeta<object>, side: EntityMeta<S>): RelationReferences {
  const pairs = foreignKeysOf(junction).flatMap(({ entity, references }) =>
    entity() === side.entity ? references : [],
  );
  return side.ids.map((key) => {
    const [pair, ...others] = pairs.filter(({ foreign }) => foreign === key);
    const referenced = `'${side.entity.name}.${key}'`;
    if (!pair) {
      const declare =
        side.ids.length > 1
          ? `a column per key, paired in a '@ManyToOne' to '${side.entity.name}'`
          : `'@Field({ references: () => ${side.entity.name} })'`;
      throw new TypeError(
        `${at} joins through '${junction.entity.name}', which has no column referencing ${referenced}: declare ${declare}.`,
      );
    }
    if (others.length) {
      const columns = [pair, ...others].map(({ local }) => `'${local}'`).join(' and ');
      throw new TypeError(
        `${at} joins through '${junction.entity.name}', where ${columns} each reference ${referenced}: a junction ` +
          'needs exactly one column per key of each side.',
      );
    }
    return { local: pair.local, foreign: key };
  });
}

/** Every key the entity marks, in declaration order. More than one is a composite primary key. */
function getIdKeys<E>(meta: EntityMeta<E>): IdKey<E>[] {
  return getKeys(meta.fields).filter((key) => meta.fields[key]?.isId) as IdKey<E>[];
}

/**
 * Merges `ancestor` and its ancestors into `meta`, nearest first, draining an undecorated base's
 * registrations. Walks the class chain, since not every compiler chains decorator metadata.
 */
function inheritFrom<E>(meta: EntityMeta<E>, ancestor: Type<object> | undefined): void {
  for (let parent = ancestor; parent && parent !== Object; parent = parentOf(parent)) {
    const base = parent as Type<E>;
    applyMembers(base, ownRegistrations(base));
    extendMeta(meta, ensureMeta(base));
  }
}

/** The class `entity` extends, `Object` where it extends nothing. */
function parentOf(entity: Type<unknown>): Type<object> | undefined {
  return Object.getPrototypeOf(entity.prototype)?.constructor;
}

function extendMeta<E>(target: EntityMeta<E>, source: EntityMeta<E>): void {
  const sourceFields = { ...source.fields };
  // A subclass declaring its own primary key drops the parent's - every column of it, or a composite
  // parent would leave its remaining keys marked and silently widen the child's key.
  if (getIdKeys(target).length) {
    for (const key of getIdKeys(source)) {
      delete sourceFields[key];
    }
  }
  target.fields = { ...sourceFields, ...target.fields };
  // A copy of each relation per entity: resolving one writes the columns it joins on into it, and those
  // columns are the resolving entity's, so one shared object left every later entity without them.
  target.relations = {
    ...Object.fromEntries(definedEntries(source.relations).map(([key, relation]) => [key, { ...relation }])),
    ...target.relations,
  };

  // Inherit user-defined filters from the parent (child overrides by name). The built-in soft-delete
  // filter + `meta.softDelete` are (re)derived from the merged fields in `defineEntity`.
  if (source.filters) {
    target.filters = { ...source.filters, ...target.filters };
  }

  // Merge hooks from parent entity (parent hooks execute first)
  if (source.hooks) {
    const hooks = (target.hooks ??= {});
    for (const [event, sourceList] of definedEntries(source.hooks)) {
      hooks[event] = [...sourceList, ...(hooks[event] ?? [])];
    }
  }
}
