import type {
  EntityData,
  EntityId,
  EntityIndexInput,
  EntityMembers,
  EntityMeta,
  EntityOptions,
  FieldKey,
  FieldMeta,
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
  WrittenId,
} from '../../type/index.js';
import { SOFT_DELETE_FILTER } from '../../type/index.js';
import { isInlinedExpression } from '../../util/field.util.js';
import {
  entityName,
  fieldOptionConflict,
  getKeys,
  ddlText,
  hasKeys,
  isToManyRelation,
  lowerFirst,
  normalizeIndexColumn,
  upperFirst,
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
  const resolved = opts.type ? opts : { ...opts, typeFromReference: true as const };
  meta.fields[fieldKey] = { ...meta.fields[fieldKey], name: key, ...resolved };
  return meta;
}

export function defineId<E>(entity: Type<E>, key: string, opts: FieldOptions): EntityMeta<E> {
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
  const meta = ensureWritableMeta(entity);
  // Registration writes the authored shape into a map declared as resolved: `getMeta` runs
  // `fillRelations`, which settles `entity`, `references` and `mappedBy` or throws. Bridging the two
  // shapes here is what lets every consumer read `RelationMeta` without asserting.
  const relations = meta.relations as Record<string, RelationOptions>;
  relations[key] = { ...relations[key], ...opts };
  return meta;
}

export function defineHook<E>(entity: Type<E>, methodName: string, event: HookEvent): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  if (!meta.hooks) meta.hooks = {};
  if (!meta.hooks[event]) meta.hooks[event] = [];
  meta.hooks[event].push({ methodName });
  return meta;
}

/**
 * Declares a composite index. `unique` and the authored column sugar are normalized here, which is what
 * lets the dialects render one shape instead of re-parsing it.
 */
export function defineIndex<E>(entity: Type<E>, index: EntityIndexInput<FieldKey<E>, E>): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  if (!meta.indexes) meta.indexes = [];
  meta.indexes.push({
    ...index,
    unique: index.unique ?? false,
    where: ddlText(index.where, 'a partial-index predicate'),
    columns: index.columns.map(normalizeIndexColumn),
  });
  return meta;
}

export function defineFilter<E>(entity: Type<E>, name: string, opts: FilterOptions<E>): EntityMeta<E> {
  const meta = ensureWritableMeta(entity);
  if (name === SOFT_DELETE_FILTER) {
    throw TypeError(
      `'${entity.name}' filter name '${SOFT_DELETE_FILTER}' is reserved; it is auto-registered from @Field({ softDelete })`,
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
    defineRelation(entity, key, spec);
  }
  for (const [event, methodNames] of definedEntries(specs?.hooks ?? {})) {
    for (const methodName of methodNames) {
      defineHook(entity, methodName, event);
    }
  }
}

/**
 * Registers an entity described by data alone, minting the class the registry keys it by. The row
 * type follows from the spec - see {@link SpecRow} - so a definition written out is checked column by
 * column, and one assembled at runtime is the column bag it is. Pass `Row` to name a shape the spec
 * cannot describe, such as the interface `uql-migrate types` generated for it.
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
  applyMembers(entity, opts);
  // Unnamed checks are named by the generator, as unnamed indexes are.
  for (const check of opts.checks ?? []) {
    (meta.checks ??= []).push({ name: check.name, expression: ddlText(check.expression, 'a check constraint') });
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

  // A later call composes onto the entity, so saying nothing about the table retracts nothing - which
  // is why `derivedName` is only ever *set*, never recomputed from what a previous call left.
  // It records that the class name stood in, telling a naming strategy there is something to derive;
  // comparing the two cannot, since an entity may name its table exactly what its class is called and
  // a spec's minted class is named after its table.
  if (opts.name !== undefined) {
    meta.name = opts.name;
    meta.derivedName = false;
  } else if (meta.name === undefined) {
    meta.name = entity.name;
    meta.derivedName = true;
  }
  meta.schema = opts.schema ?? meta.schema;
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
    meta.filters[SOFT_DELETE_FILTER] = { condition: { [meta.softDelete]: null } as QueryWhere<E>, default: true };
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

/**
 * Whether the caller named every column of the row's primary key, so {@link idOf} can name the row.
 *
 * `!= null` rather than falsiness: `0` and an empty string are ids a row can legitimately carry, and
 * reading them as "no id" is how a write of that row turned into a second insert. Distinct from
 * "does the row carry this column", which an insert asks of `undefined` alone because that is what
 * decides whether the column appears in its `VALUES` list at all.
 */
export function namesKey<E>(meta: EntityMeta<E>, row: EntityData<E>): boolean {
  return meta.ids.every((key) => row[key] != null);
}

/**
 * A row's primary key: the value itself for a single key, an object carrying every key for a
 * composite - which is {@link WrittenId}, and reads as the {@link EntityId} a `$where` takes.
 *
 * What a settled write names its rows by, and what a write hands back. Naming a composite row by one
 * of its columns would address every row agreeing on that one.
 *
 * `WrittenId` does not reduce for an unresolved `E`, so which branch this entity is in cannot be
 * proven here, only checked - which is what `ids.length` does.
 */
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

export function getEntities(): Type<unknown>[] {
  return metas.entries().reduce((acc, [key, val]) => {
    if (val.ids.length) {
      acc.push(key);
    }
    return acc;
  }, [] as Type<unknown>[]);
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
  const meta = metas.get(entity);
  if (!meta) {
    throw TypeError(`'${entity.name}' is not an entity`);
  }
  if (meta.processedAt === meta.revision) {
    return meta;
  }
  // Stamped before finalizing, not after: `fillInverseSide` reads the other side through `getMeta`,
  // and with each side mapped by the other that recursion has to find this half-filled meta rather
  // than run again. Finalizing twice is harmless anyway - every step of it skips what it settled.
  meta.processedAt = meta.revision;
  return fillRelations(meta);
}

function fillRelations<E>(meta: EntityMeta<E>): EntityMeta<E> {
  for (const [relKey, relation] of definedEntries(meta.relations)) {
    // The authored view: `mappedBy` may still be the callback and `references` unset until this settles them.
    const relOpts: RelationOptions = relation;
    const at = `'${meta.entity.name}.${relKey}'`;

    if (relOpts.mappedBy) {
      fillInverseSide(at, meta, relOpts);
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
  const relMeta = ensureMeta(relOpts.entity());

  if (relOpts.through) {
    // Both columns live on the junction, whatever the cardinality: `fillToManyThroughRelation`,
    // `deleteRelations` and every dialect read them as junction columns. A composite key contributes
    // one pair per column of it, which is what makes the join address a whole key rather than part.
    relOpts.references = [
      ...meta.ids.map((key) => ({ local: junctionColumn(meta, key), foreign: key })),
      ...relMeta.ids.map((key) => ({ local: junctionColumn(relMeta, key), foreign: key })),
    ];
    return;
  }

  if (isToManyRelation(relOpts)) {
    throw new TypeError(
      `${at} is a to-many relation with no way to join: it needs 'mappedBy' (the field on the other side), ` +
        "'through' (a junction entity), or 'references' (the columns).",
    );
  }

  // `<rel>Id` for the one-key case it has always been; `<rel><Key>` per column otherwise. Both name a
  // property, so both are spelled from the referenced *property* - a column name is what the naming
  // strategy makes of this afterwards.
  const sole = relMeta.ids.length === 1;
  relOpts.references = relMeta.ids.map((key) => ({
    local: sole ? `${relKey}Id` : `${relKey}${upperFirst(key)}`,
    foreign: key,
  }));

  // `typeFromReference` so schema generation resolves the referenced primary key's exact type
  // (columnType, length, chained keys) rather than trusting the fallback, as it does for an
  // explicit `@Field({ references })`.
  const fields: Record<string, FieldMeta | undefined> = meta.fields;
  for (const { local, foreign } of relOpts.references) {
    fields[local] ??= {
      name: local,
      type: fieldOf(relMeta, foreign).type ?? Number,
      references: relOpts.entity,
      referencedKey: foreign,
      typeFromReference: true,
    };
  }
}

function fillInverseSide<E>(at: string, meta: EntityMeta<E>, relOpts: RelationOptions): void {
  const relEntity = relOpts.entity();
  const relMeta = getMeta(relEntity);
  const mappedBy = getMappedByKey(relOpts);
  relOpts.mappedBy = mappedBy;
  if (relOpts.references) return;

  if (relMeta.fields[mappedBy]) {
    if (meta.ids.length > 1) {
      throw new TypeError(
        `${at} is mapped by '${relEntity.name}.${mappedBy}', one column, but the primary key of ` +
          `'${meta.entity.name}' is composite (${meta.ids.join(', ')}). Map it by the relation on the other side ` +
          'instead, which joins every column of the key.',
      );
    }
    // `local` is this entity's own key, as in every other pair.
    relOpts.references = [{ local: meta.ids[0], foreign: mappedBy }];
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

  // Two different flips: a junction's pairs are the owner's group followed by ours, so the two groups
  // swap - `toReversed` would also reverse each group, pairing a composite's columns crosswise. A
  // plain foreign key is one pair per key whose ends swap.
  relOpts.references =
    relOpts.cardinality === 'm1' || relOpts.cardinality === 'mm'
      ? [...owner.references.slice(relMeta.ids.length), ...owner.references.slice(0, relMeta.ids.length)]
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
    definedEntries(meta.relations).flatMap(([, relation]) => relation.references.map(({ local }) => local)),
  );
  for (const [fieldKey, { references }] of definedEntries(meta.fields)) {
    if (!references || joined.has(fieldKey)) continue;
    const target = ensureMeta(references());
    // Nothing to derive from an entity that has not registered its own fields yet.
    if (!target.ids.length) continue;
    if (target.ids.length > 1) {
      throw new TypeError(
        `'${meta.entity.name}.${fieldKey}' cannot reference '${target.entity.name}', whose primary key is composite ` +
          `(${target.ids.join(', ')}): a column points at one. Use ` +
          `'@ManyToOne({ entity: () => ${target.entity.name} })', which declares one column per key.`,
      );
    }
    const [foreign] = target.ids;
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
  return lowerFirst(entityName(meta)) + upperFirst(fieldOf(meta, idKey).name ?? idKey);
}

/** A callback only reads one property off the key map, and that property is the key, so one serves every entity. */
const RELATION_KEY_MAP = new Proxy({}, { get: (_, key) => key });

function getMappedByKey<E>(relOpts: RelationOptions<E>): Key<E> {
  return typeof relOpts.mappedBy === 'function'
    ? relOpts.mappedBy(RELATION_KEY_MAP as RelationKeyMap<E>)
    : relOpts.mappedBy!;
}

/** Every key the entity marks, in declaration order. More than one is a composite primary key. */
function getIdKeys<E>(meta: EntityMeta<E>): IdKey<E>[] {
  return getKeys(meta.fields).filter((key) => meta.fields[key]?.isId) as IdKey<E>[];
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
  target.relations = { ...source.relations, ...target.relations };

  // Inherit user-defined filters from the parent (child overrides by name). The built-in soft-delete
  // filter + `meta.softDelete` are (re)derived from the merged fields in `defineEntity`.
  if (source.filters) {
    target.filters = { ...source.filters, ...target.filters };
  }

  // Merge hooks from parent entity (parent hooks execute first)
  if (source.hooks) {
    if (!target.hooks) target.hooks = {};
    for (const [event, sourceList] of definedEntries(source.hooks)) {
      target.hooks[event] = [...sourceList, ...(target.hooks[event] ?? [])];
    }
  }
}
