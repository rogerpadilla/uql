import {
  type CheckOptions,
  type Column,
  COLUMN_OPTIONS,
  type EntityGetter,
  type EntityIndexInput,
  type EntityIndexOptions,
  type EntityMeta,
  type EntityOptions,
  type Except,
  type FieldMeta,
  type Merge,
  type FieldOptions,
  type FilterOnMissing,
  type FilterOptions,
  type HookDeclaration,
  type HookEvent,
  type HookRegistration,
  type HookFunction,
  type IdKey,
  type KeyMap,
  type RelationKey,
  type RelationMeta,
  type RelationOptions,
  type RelationReferences,
  type RelationBuilder,
  type RelationRegistration,
  type SchemaClass,
  type SchemaEntityOptions,
  type Brands,
  type EntityBrand,
  type ColumnRow,
  type SchemaFields,
  type SchemaKey,
  type SchemaRelation,
  type TriggerOptions,
  type Type,
  type AbstractType,
  type WrittenId,
  REF_KEY,
  RelationAggregate,
  SECTION_ENTRY,
  type SectionEntry,
  type DerivedFields,
  type SchemaEntity,
  SOFT_DELETE_FILTER,
} from '../../type/index.js';
import { aggregateField, defaultReadKeys, fieldKeys, isInlinedExpression } from '../../util/field.util.js';
import {
  fieldOptionConflict,
  findVectorIndex,
  valueTypesOf,
  hasKeys,
  holdsForeignKey,
  isCascadable,
  isToManyRelation,
  indexRefs,
  memberRefs,
  fulltextWeights,
  normalizeIndexColumn,
  definedEntries,
  isRecord,
  whereWith,
} from '../../util/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { type MemberRegistrations, ownRegistrations } from '../decorator/bag.js';

// oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous registry - stores EntityMeta for all entity types
type Meta = Map<AbstractType<unknown>, EntityMeta<any>>;
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

function addField<E>(meta: EntityMeta<E>, key: string, opts: FieldOptions): void {
  const { entity } = meta;
  // The types refuse this too; an untyped caller still reaches here.
  if (opts.stored && opts.computed instanceof RelationAggregate) {
    throw new UqlUsageError(
      `'${entity.name}.${key}' cannot be 'stored': a relation aggregate reads as a subquery, which no ` +
        "engine keeps in a generated column. Drop 'stored' to have it read on each query.",
    );
  }
  // A stored computed column is a real column and still needs a type; only an inlined one is exempt,
  // its expression being spliced in rather than declared.
  if (!opts.type && !opts.references && !isInlinedExpression(opts)) {
    throw new UqlUsageError(
      `'${entity.name}.${key}' needs a 'type'. Declare it - 'f.string()' - or point the field ` +
        "at another entity with 'f.references()', which resolves the column type from its primary key.",
    );
  }
  const conflict = fieldOptionConflict(opts);
  if (conflict) {
    throw new UqlUsageError(`'${entity.name}.${key}' ${conflict}.`);
  }
  // Flagged when the author gave `references` but no `type`, so schema generation knows to resolve the
  // column from the referenced primary key (picking up its `columnType`, length and chained keys)
  // instead of treating whatever ends up in `type` as deliberate.
  fieldStore(meta)[key] = { name: key, ...opts, ...(!opts.type && { typeFromReference: true }) };
}

/** `meta`'s fields as a store a key is written into: a generic entity's fields are read-only by type. */
function fieldStore<E>(meta: EntityMeta<E>): Record<string, FieldMeta | undefined> {
  return meta.fields;
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
    ...(mappedBy && { mappedBy: keyOf(mappedBy) }),
    ...(joined && { references: typeof joined === 'string' ? joined : [...joined] }),
  };
}

/** Every entity's key map: a callback only reads one property off it, and that property is its own key. */
function keyMap<E>(): KeyMap<E> {
  return KEY_MAP as KeyMap<E>;
}

/**
 * The member `pick` reads, `keyOf((post: KeyMap<Post>) => post.title)` answering `'title'`: how code generic over its
 * entity names one, since a selector follows a rename and a string does not.
 */
export function keyOf<E, K extends keyof E>(pick: (keys: KeyMap<E>) => K): K {
  return pick(keyMap<E>());
}

const KEY_MAP = new Proxy({}, { get: (_, key) => key });

function addRelation<E>(meta: EntityMeta<E>, key: string, registration: RelationRegistration): void {
  const { entity } = meta;
  if (!registration.entity) {
    throw new UqlUsageError(
      `'${entity.name}.${key}' needs an 'entity' getter, e.g. '@ManyToOne({ entity: () => Company })'.`,
    );
  }
  if (registration.through && registration.references) {
    throw new UqlUsageError(
      `'${entity.name}.${key}' joins through a junction, whose column referencing each side is the join; ` +
        "'references' pairs the declaring entity's columns with the target's instead.",
    );
  }
  // Registration writes into a map declared as resolved: `getMeta` runs `fillRelations`, which settles
  // `references` or throws. Bridging the two shapes here is what lets every consumer read `RelationMeta`
  // without asserting.
  const relations = meta.relations as Record<string, RelationRegistration>;
  relations[key] = registration;
}

/**
 * Declares a composite index, its columns read off the entity's refs. `unique` and the authored column
 * sugar are normalized here, which is what lets the dialects render one shape instead of re-parsing it.
 */
function addIndex<E>(
  meta: EntityMeta<E>,
  { columns, include, where, [SECTION_ENTRY]: _entry, ...index }: SectionEntry<EntityIndexInput<E>, 'index'>,
): void {
  const entries = columns.map(normalizeIndexColumn);
  fulltextWeights({ type: index.type, entries });
  (meta.indexes ??= []).push({
    ...index,
    unique: index.unique ?? false,
    where,
    entries,
    include: include?.map((ref) => ref[REF_KEY]),
  });
}

/**
 * Registers a trigger, its watched columns read off the entity's refs so a rename reaches them and a
 * column the entity has not got does not compile. Appended, since triggers fire in the order written.
 */
function addTrigger<E>(
  meta: EntityMeta<E>,
  { [SECTION_ENTRY]: _entry, ...trigger }: SectionEntry<TriggerOptions<E>, 'trigger'>,
): void {
  const { entity } = meta;
  // The type already refuses an empty map; this is the same answer for plain JavaScript.
  if (typeof trigger.run !== 'function' && !hasKeys(trigger.run)) {
    throw new UqlUsageError(`'${entity.name}' has a trigger whose body names at least one engine to run on`);
  }
  if (trigger.name && meta.triggers?.some((it) => it.name === trigger.name)) {
    throw new UqlUsageError(`'${entity.name}' already has a trigger named '${trigger.name}'`);
  }
  (meta.triggers ??= []).push({ ...trigger, of: trigger.of?.map((ref) => ref[REF_KEY]) });
}

function addFilter<E>(meta: EntityMeta<E>, name: string, opts: FilterOptions<E>): void {
  const { entity } = meta;
  if (name === SOFT_DELETE_FILTER) {
    throw new UqlUsageError(
      `'${entity.name}' filter name '${SOFT_DELETE_FILTER}' is reserved; a 'softDelete()' column registers it`,
    );
  }
  // Widened for a caller the types did not reach, which is the only one this can refuse.
  const { security, onMissing }: { readonly security?: boolean; readonly onMissing?: FilterOnMissing } = opts;
  if (security && onMissing === 'skip') {
    throw new UqlUsageError(
      `'${entity.name}' security filter '${name}' cannot use onMissing: 'skip' (it must fail closed)`,
    );
  }
  (meta.filters ??= {})[name] = opts;
}

/** Registers the fields, relations and hooks decorators or a schema declared, before anything is finalized. */
function applyMembers<E>(meta: EntityMeta<E>, members: Partial<MemberRegistrations> | undefined): void {
  for (const [key, spec] of definedEntries(members?.fields ?? {})) {
    addField(meta, key, spec);
  }
  for (const [key, spec] of definedEntries(members?.relations ?? {})) {
    addRelation(meta, key, spec);
  }
  for (const [event, hooks] of definedEntries(members?.hooks ?? {})) {
    const runs = hooks.map((hook) => resolvedHook(meta.entity, event, hook));
    ((meta.hooks ??= {})[event] ??= []).push(...runs);
  }
}

/** A hook method, run with the row as `this`, read off `entity` so an entity overriding it runs its own. */
function methodHook<E>(entity: AbstractType<E>, event: HookEvent, methodName: string): HookRegistration {
  // A prototype is typed `any`, so what is read off it is typed here, where it enters.
  const prototype: Record<string, unknown> = entity.prototype;
  const method = prototype[methodName];
  if (typeof method !== 'function') {
    throw new UqlUsageError(`'${entity.name}' runs '${methodName}' on ${event}, but has no such method`);
  }
  return { methodName, run: (row, ctx) => method.call(row, ctx) };
}

/**
 * A hook naming a method, by any name, `''` included, is read off `entity` again as {@link methodHook} does, so an
 * entity overriding it runs its own; a hook given as a function is kept as it is.
 */
function resolvedHook<E>(
  entity: AbstractType<E>,
  event: HookEvent,
  hook: HookDeclaration | HookRegistration,
): HookRegistration {
  if (!('run' in hook)) {
    return methodHook(entity, event, hook.methodName);
  }
  return 'methodName' in hook && hook.methodName !== undefined ? methodHook(entity, event, hook.methodName) : hook;
}

/** A row as the registry reads it, every key a column's. */
type ErasedRow = Readonly<Record<string, unknown>>;

/** A schema's relations as the registry reads them. */
type ErasedRelations = Readonly<Record<string, () => SchemaRelation<ErasedRow>>>;

/** What a schema's sections declared, as the registry reads them. */
type ErasedSections = {
  computed?: (refs: object) => Readonly<Record<string, Column>>;
  indexes?: EntityOptions<object>['indexes'];
  checks?: EntityOptions<object>['checks'];
  triggers?: EntityOptions<object>['triggers'];
  filters?: EntityOptions<object>['filters'];
  hooks?: { readonly [E in HookEvent]?: readonly HookFunction[] };
  relations?: (rel: RelationBuilder<object>) => ErasedRelations;
  derived?: (refs: object) => DerivedFields;
};

/** A schema class as the registry reads it, abstract or not. */
type ErasedClass = SchemaClass<object, unknown, unknown, boolean>;

/** A schema as the registry reads it, its row erased to {@link ErasedRow}. */
type ErasedSchema = Merge<
  SchemaEntityOptions<SchemaFields>,
  {
    readonly extends?: ErasedClass;
    readonly fields: Readonly<Record<string, Column>>;
  }
>;

/**
 * What a schema declared: its sections are open while its meta is `'declared'`, and its relations are read
 * on first lookup of it or of an entity extending it, once each target exists.
 */
type DeclaredSchema = { readonly schema: ErasedSchema; readonly sections: ErasedSections };

const declaredSchemas = new WeakMap<object, DeclaredSchema>();

type DeclaredRow<F extends SchemaFields, B> = Except<B, EntityBrand & keyof B> & ColumnRow<F> & Brands<F, B>;

/**
 * Declares an entity by its schema and returns its class, whose row type the schema derives, so nothing is
 * written twice: its columns now, then each section, `.indexes()` and so on, `.relations()` last but for
 * `.filters()`. It registers on first read, with every section in, and its relations once each target exists.
 */
export function defineEntity<const F extends SchemaFields, B = object, BK = unknown, BC = unknown>(
  schema: SchemaEntityOptions<F, B, BK, BC> & { readonly abstract: true },
): SchemaEntity<DeclaredRow<F, B>, SchemaKey<F, BK>, BC & ColumnRow<F>, B, true>;
export function defineEntity<const F extends SchemaFields, B = object, BK = unknown, BC = unknown>(
  schema: SchemaEntityOptions<F, B, BK, BC>,
): SchemaEntity<DeclaredRow<F, B>, SchemaKey<F, BK>, BC & ColumnRow<F>, B>;
export function defineEntity(schema: ErasedSchema): ErasedClass {
  const base = schema.extends ?? Object;
  // Its rows are read by key alone, which is what the registry types an erased schema's columns by.
  const entity = {
    [schema.name]: class extends base {
      [key: string]: unknown;
    },
  }[schema.name];
  metas.set(entity, { ...emptyMeta(entity), stage: 'declared' });
  declaredSchemas.set(entity, { schema, sections: {} });
  for (const section of SECTIONS) {
    Object.defineProperty(entity, section, {
      value(this: AbstractType<object>, declared: unknown, derived?: unknown) {
        declareSection(this, section, declared);
        if (section === 'relations' && derived) {
          declareSection(this, 'derived', derived);
        }
        return this;
      },
    });
  }
  return entity;
}

/** The sections a schema declares as methods. `derived` is no method: `relations` takes it as its second argument. */
const SECTIONS = ['computed', 'indexes', 'checks', 'triggers', 'filters', 'hooks', 'relations'] as const;

/** Records one section of a pending schema, refusing a second of it and one declared after the entity was read. */
function declareSection(entity: AbstractType<object>, section: string, declared: unknown): void {
  const pending = pendingSchema(entity);
  if (!pending) {
    throw new UqlUsageError(`'${entity.name}' was read already: declare its ${section} before its first use`);
  }
  if (section in pending.sections) {
    throw new UqlUsageError(`'${entity.name}' declares its ${section} twice: declare them in one call`);
  }
  Object.assign(pending.sections, { [section]: declared });
}

/** What `entity` declared as a schema, while it is not registered yet. */
function pendingSchema(entity: AbstractType<unknown>): DeclaredSchema | undefined {
  return metas.get(entity)?.stage === 'declared' ? declaredSchemas.get(entity) : undefined;
}

/** Registers a pending schema, its base's first; a failure leaves it pending, so a later read reports it again. */
function settleSchema(entity: AbstractType<unknown>): void {
  const pending = pendingSchema(entity);
  if (!pending) {
    return;
  }
  const { schema, sections } = pending;
  const fields = fieldsOf(schema.name, schema.fields);
  const refs = memberRefs();
  for (const added of [
    fieldsOf(schema.name, sections.computed?.(refs) ?? {}),
    fieldsOf(schema.name, readDerived(sections.derived, refs)),
  ]) {
    const taken = Object.keys(added).find((key) => key in fields);
    if (taken) {
      throw new UqlUsageError(`'${schema.name}.${taken}' is declared twice: name each member once`);
    }
    Object.assign(fields, added);
  }
  registerEntity(
    entity,
    {
      name: schema.table,
      schema: schema.schema,
      abstract: schema.abstract,
      indexes: sections.indexes,
      checks: sections.checks,
      triggers: sections.triggers,
      filters: sections.filters,
    },
    {
      fields,
      hooks: Object.fromEntries(
        definedEntries(sections.hooks ?? {}).map(([event, runs]) => [event, runs.map((run) => ({ run }))]),
      ),
    },
  );
}

/** An index as a section's `index(columns, options)` writes it, a bare string its name. */
function indexEntry<E>(
  columns: EntityIndexInput<E>['columns'],
  options?: string | EntityIndexOptions<E>,
): SectionEntry<EntityIndexInput<E>, 'index'> {
  const stated = typeof options === 'string' ? { name: options } : options;
  return { ...stated, columns, [SECTION_ENTRY]: 'index' };
}

function checkEntry<E>(where: CheckOptions<E>['where'], name?: string): SectionEntry<CheckOptions<E>, 'check'> {
  return { where, ...(name !== undefined && { name }), [SECTION_ENTRY]: 'check' };
}

function triggerEntry<E>(trigger: TriggerOptions<E>): SectionEntry<TriggerOptions<E>, 'trigger'> {
  return { ...trigger, [SECTION_ENTRY]: 'trigger' };
}

/** The fields a section's values define: a column's options, or an aggregate, which reads as a computed column. */
function fieldsOf(name: string, values: Readonly<Record<string, unknown>>): Record<string, FieldOptions> {
  return Object.fromEntries(
    Object.entries(values).map(([key, field]): [string, FieldOptions] => {
      if (field instanceof RelationAggregate) {
        return [key, aggregateField(field)];
      }
      // The types refuse anything else; an untyped caller still reaches here.
      if (!isColumn(field)) {
        throw new UqlUsageError(`'${name}.${key}' is neither a column nor an aggregate: declare it as one`);
      }
      return [key, field[COLUMN_OPTIONS]];
    }),
  );
}

function isColumn(field: unknown): field is Column {
  return isRecord(field) && COLUMN_OPTIONS in field;
}

/** A relation's derived fields, each a thunk read lazily; a value that is no thunk is passed on to be refused. */
function readDerived(derived: ErasedSections['derived'], refs: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(derived?.(refs) ?? {}).map(([key, read]) => [key, typeof read === 'function' ? read() : read]),
  );
}

const RELATION_BUILDER: RelationBuilder<object> = {
  oneToOne: (target, options) => ({ target, cardinality: '11', options }),
  manyToOne: (target, options) => ({ target, cardinality: 'm1', options }),
  oneToMany: (target, options) => ({ target, cardinality: '1m', options }),
  manyToMany: (target, options) => ({ target, cardinality: 'mm', options }),
};

/**
 * Settles an entity's relations, once: its schema's, read now that each target exists, beside those its decorators
 * registered, then a copy of each its base settled that it does not declare itself. The one place either form
 * inherits a relation. Marked after, so a read after a failure reports the same mistake again.
 */
function settleRelations<E>(meta: EntityMeta<E>): void {
  if (meta.stage === 'settled' || meta.stage === 'resolved') {
    return;
  }
  const parent = parentOf(meta.entity);
  const inherited: EntityMeta<object>['relations'] =
    parent && metas.has(parent) ? registeredMeta(parent).relations : {};
  const declared = declaredSchemas.get(meta.entity)?.sections.relations;
  for (const [key, read] of Object.entries(declared?.(RELATION_BUILDER) ?? {})) {
    const { target, cardinality, options } = read();
    addRelation(
      meta,
      key,
      relationRegistration<ErasedRow, object>({ ...options, cardinality, entity: () => tableOf<ErasedRow>(target) }),
    );
  }
  // A copy per entity: resolving a relation writes the columns it joins on into it, and those are the resolving
  // entity's, so one shared object would leave every later entity without them.
  meta.relations = {
    ...Object.fromEntries(definedEntries(inherited).map(([key, relation]) => [key, { ...relation }])),
    ...meta.relations,
  };
  meta.stage = 'settled';
}

/**
 * The registration both forms share, a schema's `members` given as the decorators would register them. Built
 * apart and stored once it passes, so a rejected definition leaves the registry as it was.
 */
export function registerEntity<E>(
  entity: AbstractType<E>,
  opts: EntityOptions<E> = {},
  members?: Partial<MemberRegistrations>,
): EntityMeta<E> {
  // A dotted name reads like a schema and is not one: it escapes as a single identifier, so the
  // statement builds and then fails at the database. `schema` is the way to say it.
  const table = opts.name ?? entity.name;
  if (table.includes('.')) {
    const [schema, ...rest] = table.split('.');
    throw new UqlUsageError(
      `'${entity.name}' has a dotted name '${table}'. Name the schema separately as ` +
        `{ schema: '${schema}', name: '${rest.join('.')}' }.`,
    );
  }
  const meta = emptyMeta(entity);
  applyMembers(meta, members);
  // Unnamed checks are named by the generator, as unnamed indexes are.
  for (const check of opts.checks?.(memberRefs<E>(), checkEntry) ?? []) {
    (meta.checks ??= []).push({ name: check.name, where: check.where });
  }
  for (const index of opts.indexes?.(indexRefs<E>(), indexEntry) ?? []) {
    addIndex(meta, index);
  }
  for (const trigger of opts.triggers?.(memberRefs<E>(), triggerEntry) ?? []) {
    addTrigger(meta, trigger);
  }
  for (const [name, filter] of definedEntries(opts.filters ?? {})) {
    addFilter(meta, name, filter);
  }

  // `derivedName` records that the class name stood in, which is what a naming strategy derives from.
  meta.name = table;
  meta.derivedName = opts.name === undefined;
  meta.schema = opts.schema;
  meta.abstract = opts.abstract;
  inheritFrom(meta, parentOf(entity));

  if (!hasKeys(meta.fields)) {
    throw new UqlUsageError(`'${entity.name}' must have fields`);
  }
  for (const [key, field] of definedEntries(meta.fields)) {
    const ranked = field.distance && findVectorIndex(meta, key)?.distance;
    if (ranked && ranked !== field.distance) {
      throw new UqlUsageError(
        `'${entity.name}.${key}' measures by '${field.distance}', but its vector index ranks by '${ranked}': name one metric`,
      );
    }
  }

  // Derive soft-delete from the (inheritance-merged) fields, so own and inherited markers are handled
  // uniformly. Exactly one field may be marked; it auto-registers the built-in `softDelete` read
  // filter (a reserved name - see addFilter - so it never clobbers a user filter).
  const softDeleteKeys = fieldKeys(meta, ({ softDelete }) => softDelete !== undefined && softDelete !== false);
  if (softDeleteKeys.length > 1) {
    throw new UqlUsageError(`'${entity.name}' must have at most one field with 'softDelete'`);
  }
  if (softDeleteKeys.length) {
    meta.softDelete = softDeleteKeys[0];
    (meta.filters ??= {})[SOFT_DELETE_FILTER] = { where: whereWith(meta.softDelete, null), default: true };
  }

  // The optimistic lock, derived the same way and just as singular: one row has one version.
  const versionKeys = fieldKeys(meta, (field) => field.version);
  if (versionKeys.length > 1) {
    throw new UqlUsageError(`'${entity.name}' must have at most one field with 'version'`);
  }
  if (versionKeys.length) {
    meta.version = versionKeys[0];
    // Implied rather than stated: the DDL default covers a row written around the ORM, and `onInsert`
    // covers MongoDB, which has no DDL to default. Both, so every backend starts a row at the same 0.
    const field = meta.fields[meta.version]!;
    meta.fields[meta.version] = { ...field, defaultValue: 0, onInsert: 0 };
  }

  const ids = getIdKeys(meta);
  if (!ids.length && !meta.abstract) {
    throw new UqlUsageError(
      `'${entity.name}' must have at least one id field (declare one with 'id()', as in 'f.number().id()')`,
    );
  }
  meta.ids = ids;

  metas.set(entity, meta);
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
  throw new UqlUsageError(
    ids.length
      ? `'${meta.entity.name}' has a composite primary key (${ids.join(', ')}), which ${what} does not support.`
      : // An entity registered with `@Field` but no `@Entity` never ran the check registration makes.
        `'${meta.entity.name}' has no primary key, which ${what} needs.`,
  );
}

/** The entity's one primary key, for a path that cannot express a composite. See {@link assertSoleId}. */
export function soleIdOf<E>(meta: EntityMeta<E>, what: string): IdKey<E> {
  assertSoleId(meta, what);
  return meta.ids[0];
}

/** The one key column and its field, or nothing on a composite key. */
export function soleId<E>(meta: EntityMeta<E>): { readonly key: IdKey<E>; readonly field: FieldMeta } | undefined {
  const [key] = meta.ids;
  const field = meta.ids.length === 1 ? meta.fields[key] : undefined;
  return field && { key, field };
}

/** The field `key` names, for a caller that took `key` from the metadata itself. */
export function fieldOf<E>(meta: EntityMeta<E>, key: string): FieldMeta {
  const field = meta.fields[key];
  if (!field) {
    throw new UqlUsageError(`'${meta.entity.name}' has no field '${key}'`);
  }
  return field;
}

/**
 * The field whose type `field`'s values take: the key it references where it gave `references` and neither a
 * `type` nor a `columnType`, followed down a chain of them; `field` itself otherwise.
 */
export function valueFieldOf(field: FieldMeta, seen?: Set<EntityGetter>): FieldMeta {
  if (field.columnType || !field.typeFromReference || !field.references || seen?.has(field.references)) {
    return field;
  }
  seen = (seen ?? new Set()).add(field.references);
  const target = registeredMeta(field.references());
  return valueFieldOf(fieldOf(target, soleIdOf(target, 'a foreign key')), seen);
}

/** The relation `key` names, for a caller that took `key` from the metadata itself. */
export function relationOf<E>(meta: EntityMeta<E>, key: RelationKey<E>): RelationMeta {
  const relation = meta.relations[key];
  if (!relation) {
    throw new UqlUsageError(`'${meta.entity.name}' has no relation '${key}'`);
  }
  return relation;
}

/** A row of `E` as far as reading its key goes: a record or a write, whatever its values. */
export type KeyedRow<E> = { readonly [K in keyof E]?: unknown };

/** Whether the row names every column of its primary key, `0` and `''` included. */
export function namesKey<E>(meta: EntityMeta<E>, row: KeyedRow<E>): boolean {
  return meta.ids.every((key) => row[key] != null);
}

/** A row's primary key: its value, or a map of every column on a composite, checked at run time. */
export function idOf<E>(meta: EntityMeta<E>, row: KeyedRow<E>): WrittenId<E> {
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
export function removeEntity<E>(entity: AbstractType<E>): boolean {
  return metas.delete(entity);
}

export function getEntities(): Type<object>[] {
  for (const entity of metas.keys()) {
    settleSchema(entity);
  }
  return [...metas.values()]
    .filter((meta) => meta.ids.length)
    .map((meta) => meta.entity)
    .filter(isTable);
}

/** The class a schema relation targets, refused where it is abstract: a relation needs a table to join. */
function tableOf<E extends object>(target: AbstractType<E>): Type<E> {
  if (!isTable(target)) {
    throw new UqlUsageError(`'${target.name}' is abstract: a relation needs a table to join`);
  }
  return target;
}

/** Whether `entity` is a table: not marked abstract, so a query or write can take it. */
function isTable<E extends object>(entity: AbstractType<E>): entity is Type<E> {
  return !metas.get(entity)?.abstract;
}

/** The metadata `entity` has, a pending schema registered first, without settling anything further. */
function knownMeta<E>(entity: AbstractType<E>): EntityMeta<E> {
  settleSchema(entity);
  return ensureMeta(entity);
}

function ensureMeta<E>(entity: AbstractType<E>): EntityMeta<E> {
  let meta = metas.get(entity);
  if (meta) {
    return meta;
  }
  meta = emptyMeta(entity);
  metas.set(entity, meta);
  return meta;
}

function emptyMeta<E>(entity: AbstractType<E>): EntityMeta<E> {
  return { entity, ids: [], fields: {}, relations: {} };
}

export function getMeta<E>(entity: AbstractType<E>): EntityMeta<E> {
  const resolved = metas.get(entity);
  if (resolved?.stage === 'resolved') {
    return resolved;
  }
  const meta = registeredMeta(entity);
  if (meta.abstract) {
    throw new UqlUsageError(`'${entity.name}' is abstract: read an entity extending it`);
  }
  // Stamped once finalizing succeeds, so a read after a failure reports the same mistake again. Finalizing
  // reads other entities without resolving them, so no entity is ever read half resolved.
  fillRelations(meta);
  meta.readKeys = defaultReadKeys(meta);
  meta.stage = 'resolved';
  return meta;
}

/** The metadata `entity` registered, however much of it is resolved. */
function registeredMeta<E>(entity: AbstractType<E>): EntityMeta<E> {
  settleSchema(entity);
  const meta = metas.get(entity);
  if (!meta) {
    throw new UqlUsageError(`'${entity.name}' is not an entity`);
  }
  settleRelations(meta);
  return meta;
}

function fillRelations<E>(meta: EntityMeta<E>): void {
  for (const [relKey, relation] of definedEntries(meta.relations)) {
    const at = `'${meta.entity.name}.${relKey}'`;
    const references = settledReferences(at, meta, relation);
    if (!references.length) {
      throw new UqlUsageError(`${at} has no columns to join on.`);
    }
    if (!relation.through) {
      assertJoins(at, meta, relation, references);
    }
    if (holdsForeignKey(relation) && isCascadable('delete', relation.cascade)) {
      throw new UqlUsageError(
        `${at} holds the key of a '${relation.entity().name}' other rows may point at too, so it cascades ` +
          "'persist' only: cascade a delete from the side that owns the rows.",
      );
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
function settledReferences<E>(at: string, meta: EntityMeta<E>, relOpts: RelationRegistration): RelationReferences {
  const { references, mappedBy, through } = relOpts;
  if (typeof references === 'string') {
    const target = knownMeta(relOpts.entity());
    if (mappedBy || isToManyRelation(relOpts) || target.ids.length > 1) {
      throw new UqlUsageError(
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
  const inferred = inferredJoin(at, meta, relOpts);
  if (inferred) {
    Object.assign(relOpts, inferred);
    return settledReferences(at, meta, relOpts);
  }
  throw new UqlUsageError(
    isToManyRelation(relOpts)
      ? `${at} is a to-many relation with no way to join: it needs 'mappedBy' (the member on the other side), ` +
          "'through' (a junction entity), or 'references' (the columns)."
      : `${at} needs 'references', the foreign key column it joins by, or 'mappedBy', the member on the other ` +
          'side holding it.',
  );
}

/**
 * The join a relation naming none can only mean: a many-to-one's one field referencing its target, a one-to-many's
 * one many-to-one on the target pointing back. Nothing where there is none; refused where there are several.
 */
function inferredJoin<E>(
  at: string,
  meta: EntityMeta<E>,
  relOpts: RelationRegistration,
): Pick<RelationRegistration, 'references' | 'mappedBy'> | undefined {
  const target = relOpts.entity();
  if (relOpts.cardinality === 'm1') {
    const columns = fieldKeys(meta, (field) => !!field.references && isA(target, field.references()));
    const references = onlyCandidate(at, columns, 'join by', `a foreign key to '${target.name}'`, 'references');
    return references === undefined ? undefined : { references };
  }
  if (relOpts.cardinality === '1m') {
    const back = definedEntries(registeredMeta(target).relations)
      .filter(([, relation]) => relation.cardinality === 'm1' && isA(meta.entity, relation.entity()))
      .map(([key]) => key);
    const mappedBy = onlyCandidate(at, back, 'be mapped by', `a relation to '${meta.entity.name}'`, 'mappedBy');
    return mappedBy === undefined ? undefined : { mappedBy };
  }
  return undefined;
}

/** The one candidate, nothing for none, and a refusal naming each where there are several. */
function onlyCandidate(
  at: string,
  candidates: readonly string[],
  verb: string,
  each: string,
  option: string,
): string | undefined {
  if (candidates.length > 1) {
    const named = candidates.map((key) => `'${key}'`);
    throw new UqlUsageError(
      `${at} could ${verb} ${named.slice(0, -1).join(', ')} or ${named.at(-1)}, each ${each}: name one with '${option}'.`,
    );
  }
  return candidates[0];
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
    ...junctionReferences(at, junction, knownMeta(relOpts.entity())),
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
      throw new UqlUsageError(
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
    throw new UqlUsageError(
      `${at} is mapped by '${mappedBy}', which is neither a field nor a relation of '${relMeta.entity.name}'.`,
    );
  }
  if (owner.mappedBy) {
    throw new UqlUsageError(`${at} is mapped by ${other}, an inverse side too, so neither owns the foreign key.`);
  }
  const ownerTarget = owner.entity();
  if (!isA(meta.entity, ownerTarget)) {
    throw new UqlUsageError(
      `${at} is mapped by ${other}, a relation to '${ownerTarget.name}', not to '${meta.entity.name}'.`,
    );
  }
  const ownerReferences = settledReferences(other, relMeta, owner);

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
 * Refuses a join on a column either entity does not store, a one-column join whose foreign key, on whichever
 * side holds it, points at another entity, and a join whose column holds another kind of value than its key.
 */
function assertJoins<E>(
  at: string,
  meta: EntityMeta<E>,
  relOpts: RelationRegistration,
  pairs: RelationReferences,
): void {
  const target = registeredMeta(relOpts.entity());
  // Only the owning side of a to-one holds its foreign key; an inverse side and a to-many join on the target's.
  const holdsLocally = holdsForeignKey(relOpts);
  const single = pairs.length === 1;
  for (const { local, foreign } of pairs) {
    assertJoinColumn(at, { meta, key: local, joins: target.entity, holds: holdsLocally && single });
    assertJoinColumn(at, { meta: target, key: foreign, joins: meta.entity, holds: !holdsLocally && single });
    if (holdsLocally) {
      assertKindsJoin(at, fieldOf(meta, local), valueFieldOf(fieldOf(target, foreign)), target.entity.name);
    }
  }
}

/** Refuses a join column that is no column, or a foreign key to another entity than the one it joins. */
function assertJoinColumn(
  at: string,
  side: {
    meta: { entity: AbstractType<unknown>; fields: Record<string, FieldMeta | undefined> };
    key: string;
    joins: AbstractType<unknown>;
    holds: boolean;
  },
): void {
  const column = `'${side.meta.entity.name}.${side.key}'`;
  const field = side.meta.fields[side.key];
  if (!field || isInlinedExpression(field)) {
    throw new UqlUsageError(`${at} joins ${column}, which is not a column: declare it with '@Field'.`);
  }
  const referenced = side.holds ? field.references?.() : undefined;
  if (referenced && !isA(side.joins, referenced)) {
    throw new UqlUsageError(
      `${at} joins ${column}, a foreign key to '${referenced.name}', not to '${side.joins.name}'.`,
    );
  }
}

/** Whether `entity` is `base` or extends it, as an entity inheriting a relation does. */
function isA(entity: AbstractType<unknown>, base: AbstractType<unknown>): boolean {
  return entity === base || entity.prototype instanceof base;
}

/**
 * The foreign keys an entity holds: each owning to-one's columns, and each `f.references()` no
 * relation joins on, as the many-to-one it describes, once its target has registered a key. What the
 * schema build constrains and a junction joins by, settling the relations holding them first.
 */
export function foreignKeysOf<E>(meta: EntityMeta<E>): RelationMeta[] {
  const owning = definedEntries(meta.relations)
    .filter(([, relation]) => holdsForeignKey(relation))
    .map(([relKey, relation]) => {
      settledReferences(`'${meta.entity.name}.${relKey}'`, meta, relation);
      return relation;
    });
  const joined = new Set(owning.flatMap(({ references }) => references.map(({ local }) => local)));
  const columns = definedEntries(meta.fields).flatMap(([key, field]): RelationMeta[] => {
    if (!field.references) return [];
    const target = knownMeta(field.references());
    // A joined column's kinds were checked when its relation settled.
    if (joined.has(key) || !target.ids.length) return [];
    if (!field.typeFromReference && target.ids.length === 1) {
      assertKindsJoin(
        `'${meta.entity.name}.${key}'`,
        field,
        valueFieldOf(fieldOf(target, target.ids[0])),
        target.entity.name,
      );
    }
    if (target.ids.length > 1) {
      throw new UqlUsageError(
        `'${meta.entity.name}.${key}' cannot reference '${target.entity.name}', whose primary key is composite ` +
          `(${target.ids.join(', ')}): a column points at one. Declare a column per key and pair each with it ` +
          `in a '@ManyToOne' to '${target.entity.name}'.`,
      );
    }
    return [{ entity: field.references, cardinality: 'm1', references: [{ local: key, foreign: target.ids[0] }] }];
  });
  return [...owning, ...columns];
}

/** The kinds a column of `type` holds as a join compares them, as `JoinKind` does: a bigint is a number, which BIGINT widens. */
function joinedKinds(type: FieldMeta['type']) {
  const types = valueTypesOf(type);
  return types && [...new Set(types.map((kind) => (kind === 'bigint' ? 'number' : kind)))];
}

/** Refuses a join whose column holds another kind of value than the key it joins to, which no join matches. */
function assertKindsJoin(at: string, held: FieldMeta, key: FieldMeta, target: string): void {
  const heldKinds = joinedKinds(held.type);
  if (!heldKinds) return;
  const neededKinds = joinedKinds(key.type);
  if (neededKinds && !neededKinds.every((kind) => heldKinds.includes(kind))) {
    throw new UqlUsageError(
      `${at} holds a ${heldKinds.join(' or ')}, but the key of '${target}' it references is a ${neededKinds.join(' or ')}`,
    );
  }
}

/** Each key of `side`, paired with the one column of `junction` referencing it: a rename of either follows. */
function junctionReferences<S>(at: string, junction: EntityMeta<object>, side: EntityMeta<S>): RelationReferences {
  const pairs = foreignKeysOf(junction).flatMap(({ entity, references }) =>
    Object.is(entity(), side.entity) ? references : [],
  );
  return side.ids.map((key) => {
    const [pair, ...others] = pairs.filter(({ foreign }) => foreign === key);
    const referenced = `'${side.entity.name}.${key}'`;
    if (!pair) {
      const declare =
        side.ids.length > 1
          ? `a column per key, paired in a '@ManyToOne' to '${side.entity.name}'`
          : `'f.references(() => ${side.entity.name})'`;
      throw new UqlUsageError(
        `${at} joins through '${junction.entity.name}', which has no column referencing ${referenced}: declare ${declare}.`,
      );
    }
    if (others.length) {
      const columns = [pair, ...others].map(({ local }) => `'${local}'`).join(' and ');
      throw new UqlUsageError(
        `${at} joins through '${junction.entity.name}', where ${columns} each reference ${referenced}: a junction ` +
          'needs exactly one column per key of each side.',
      );
    }
    return { local: pair.local, foreign: key };
  });
}

/** Every key the entity marks, in declaration order. More than one is a composite primary key. */
function getIdKeys<E>(meta: EntityMeta<E>): IdKey<E>[] {
  return fieldKeys(meta, (field) => field.isId) as IdKey<E>[];
}

/**
 * Merges `ancestor` and its ancestors into `meta`, nearest first, draining an undecorated base's
 * registrations. Walks the class chain, since not every compiler chains decorator metadata.
 */
function inheritFrom<E>(meta: EntityMeta<E>, ancestor: AbstractType<object> | undefined): void {
  for (let parent = ancestor; parent && parent !== Object; parent = parentOf(parent)) {
    const base = parent as AbstractType<E>;
    applyMembers(ensureMeta(base), ownRegistrations(base));
    extendMeta(meta, knownMeta(base));
  }
}

/** The class `entity` extends, `Object` where it extends nothing. */
function parentOf(entity: AbstractType<unknown>): AbstractType<object> | undefined {
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

  // Inherit user-defined filters from the parent (child overrides by name). The built-in soft-delete
  // filter + `meta.softDelete` are (re)derived from the merged fields at registration.
  if (source.filters) {
    target.filters = { ...source.filters, ...target.filters };
  }

  // A base's hooks fire first, as its triggers do: they are the entries written before the child's own.
  for (const [event, sourceList] of definedEntries(source.hooks ?? {})) {
    const rebound = sourceList.map((hook) => resolvedHook(target.entity, event, hook));
    (target.hooks ??= {})[event] = inheritedEntries(rebound, target.hooks?.[event], (hook) => hook.methodName);
  }
  target.indexes = inheritedEntries(source.indexes, target.indexes, (index) => index.name);
  target.checks = inheritedEntries(source.checks, target.checks, (check) => check.name);
  target.triggers = inheritedEntries(source.triggers, target.triggers, (trigger) => trigger.name);
}

/** `source`'s entries ahead of `own`, each once, and a same-named `own` entry replaces its base's. */
function inheritedEntries<T extends object>(
  source: readonly T[] | undefined,
  own: readonly T[] | undefined,
  nameOf: (entry: T) => string | undefined,
): T[] | undefined {
  if (!source?.length) {
    return own && [...own];
  }
  const taken = new Set((own ?? []).map(nameOf));
  const inherited = source.filter((entry) => nameOf(entry) === undefined || !taken.has(nameOf(entry)));
  return [...new Set([...inherited, ...(own ?? [])])];
}
