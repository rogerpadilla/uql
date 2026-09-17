import type { FieldOptions, HookEvent, RelationRegistration, Type } from '../../type/index.js';

/**
 * Polyfills `Symbol.metadata`, without which TypeScript builds no `context.metadata` and every field is
 * silently dropped. `Symbol.for`, the key esbuild and SWC fall back to, so duplicated modules agree.
 */
const symbolCtor: { metadata?: symbol } = Symbol;
symbolCtor.metadata ??= Symbol.for('Symbol.metadata');

/** Where member registrations live on the per-class metadata object. */
const registrations = Symbol.for('uql-orm/entity/decoratorMembers');

/**
 * What the member decorators record for one class, until `@Entity()` or `defineEntity` drains it: the
 * only channel from a member decorator to its class. The writable counterpart of `EntityMembers`.
 */
export type MemberRegistrations = {
  readonly fields: Record<string, FieldOptions>;
  readonly relations: Record<string, RelationRegistration>;
  readonly hooks: Partial<Record<HookEvent, string[]>>;
};

/**
 * The class's own registrations, created on first use, never read through a parent's: inheritance walks
 * the class chain, since not every compiler chains decorator metadata.
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
 * The registrations a class made for itself, readable once it is fully defined: `@Entity()` reads
 * `context.metadata` instead, since the class gets `Symbol.metadata` after its decorators return.
 */
export function ownRegistrations(entity: Type<unknown>): MemberRegistrations | undefined {
  const metadata: DecoratorMetadata | undefined = Object.getOwnPropertyDescriptor(entity, Symbol.metadata)?.value;
  return drainRegistrations(metadata);
}
