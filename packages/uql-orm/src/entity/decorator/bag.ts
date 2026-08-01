import type { FieldOptions, HookEvent, RelationOptions, Type } from '../../type/index.js';

/**
 * Polyfill `Symbol.metadata`, which no runtime we support defines yet (checked on Node 24 and Bun
 * 1.3): TypeScript's decorator emit reads it to decide whether to build the metadata object at all, so
 * without this every `context.metadata` is `undefined` and field registration is silently dropped
 * rather than failing.
 *
 * `Symbol.for`, not `Symbol()`, so a duplicated copy of this module (HMR, federated bundles, ESM+CJS
 * dual-loading) lands on the same symbol, and so it agrees with the key esbuild and SWC fall back to
 * (`Symbol.metadata ?? Symbol.for('Symbol.metadata')`). Assigned through a widened alias because the
 * lib declares the property `readonly`; when a runtime does define it, `??=` leaves it alone.
 */
const symbolCtor: { metadata?: symbol } = Symbol;
symbolCtor.metadata ??= Symbol.for('Symbol.metadata');

/** Where member registrations live on the per-class metadata object. */
const registrations = Symbol.for('uql-orm/entity/decoratorMembers');

/**
 * What the member decorators record for one class, waiting for `@Entity()` or `defineEntity` to drain
 * it into the metadata registry. Member decorators receive no class reference under the standard
 * decorator spec, so this object is the only channel between them and the class decorator that does.
 */
export type MemberRegistrations = {
  readonly fields: Record<string, FieldOptions>;
  readonly relations: Record<string, RelationOptions>;
  readonly hooks: Partial<Record<HookEvent, string[]>>;
};

/**
 * The calling class's own registrations, created on first use.
 *
 * Deliberately holds **only** this class's members: inheritance is resolved later by walking the class
 * prototype chain, not by reading through the metadata object's. tsc chains a subclass's metadata to its
 * parent's and SWC does not, so anything built on that chain would work under one compiler and quietly
 * lose inherited fields under the other. Keeping each bag to its own members also means a parent's map
 * is never shared with its subclasses, and hooks cannot be registered twice.
 */
export function memberRegistrations(metadata: DecoratorMetadata): MemberRegistrations {
  if (!Object.hasOwn(metadata, registrations)) {
    metadata[registrations] = { fields: {}, relations: {}, hooks: {} } satisfies MemberRegistrations;
  }
  return metadata[registrations] as MemberRegistrations;
}

/**
 * Takes the registrations belonging to `metadata`, leaving none behind, so finalizing an entity twice
 * cannot register its hooks twice.
 */
export function drainRegistrations(metadata: DecoratorMetadata | undefined): MemberRegistrations | undefined {
  if (!metadata || !Object.hasOwn(metadata, registrations)) {
    return undefined;
  }
  const own = metadata[registrations] as MemberRegistrations;
  delete metadata[registrations];
  return own;
}

/**
 * The registrations a class made for itself.
 *
 * @remarks Only usable once the class is fully defined, which is why `@Entity()` reads
 * `context.metadata` instead: TypeScript attaches `Symbol.metadata` to the class *after* its class
 * decorators return. Ancestors are always fully defined by then, so this is how inherited members are
 * collected.
 */
export function ownRegistrations(entity: Type<unknown>): MemberRegistrations | undefined {
  const metadata: DecoratorMetadata | undefined = Object.getOwnPropertyDescriptor(entity, Symbol.metadata)?.value;
  return drainRegistrations(metadata);
}
