import { describe, expect, it } from 'vitest';
import type { HookContext } from '../../util/index.js';
import {
  BeforeInsert,
  defineEntity,
  defineField,
  defineRelation,
  Entity,
  Field,
  getMeta,
  Id,
  Index,
  ManyToOne,
  OneToMany,
} from '../index.js';
import { applyMembers } from '../metadata/definition.js';
import { drainRegistrations, memberRegistrations } from './bag.js';

/**
 * End-to-end checks for the TC39 decorator path, on the cases that would otherwise fail silently.
 *
 * The important one is inheritance. Member decorators get no class reference under the standard spec,
 * so members are recorded on `context.metadata` and drained by the class decorator. tsc and esbuild
 * prototype-chain a subclass's metadata to its parent's, SWC does not, so uql resolves inheritance by
 * walking the *class* prototype chain instead. These assertions are what keep it that way.
 */
describe('standard decorators', () => {
  it('registers fields, the id and the entity name', () => {
    @Entity()
    class Basic {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) title?: string;
    }

    const meta = getMeta(Basic);
    expect(meta.name).toBe('Basic');
    expect(meta.id).toBe('id');
    expect(Object.keys(meta.fields)).toEqual(['id', 'title']);
    expect(meta.fields['title']!.type).toBe(String);
  });

  it('inherits fields from an undecorated abstract base, parent fields first', () => {
    abstract class Base {
      @Id({ type: Number }) id?: number;
      @Field({ type: Date }) createdAt?: Date;
    }

    @Entity()
    class Child extends Base {
      @Field({ type: String }) name?: string;
    }

    const meta = getMeta(Child);
    // Order matters: it decides generated DDL column order.
    expect(Object.keys(meta.fields)).toEqual(['id', 'createdAt', 'name']);
    expect(meta.id).toBe('id');
  });

  it('keeps sibling subclasses of one base independent', () => {
    abstract class Shared {
      @Id({ type: Number }) id?: number;
    }

    @Entity()
    class Left extends Shared {
      @Field({ type: String }) leftOnly?: string;
    }

    @Entity()
    class Right extends Shared {
      @Field({ type: Number }) rightOnly?: number;
    }

    // A bag that copied its parent's map, or mutated a shared one, would leak these into each other.
    expect(Object.keys(getMeta(Left).fields)).toEqual(['id', 'leftOnly']);
    expect(Object.keys(getMeta(Right).fields)).toEqual(['id', 'rightOnly']);
  });

  it('registers an inherited hook exactly once', () => {
    abstract class HookedBase {
      @Id({ type: Number }) id?: number;

      @BeforeInsert()
      stamp(_ctx: HookContext) {}
    }

    @Entity()
    class HookedChild extends HookedBase {
      @Field({ type: String }) name?: string;
    }

    // Both the bag drain and `extendMeta` see this hook; only one of them may register it.
    expect(getMeta(HookedChild).hooks?.beforeInsert).toEqual([{ methodName: 'stamp' }]);
  });

  it('registers relations from the entity getter', () => {
    @Entity()
    class Owner {
      @Id({ type: Number }) id?: number;
      @OneToMany({ entity: () => Owned, mappedBy: 'owner' }) owned?: Owned[];
    }

    @Entity()
    class Owned {
      @Id({ type: Number }) id?: number;
      @Field({ references: () => Owner }) ownerId?: number;
      @ManyToOne({ entity: () => Owner }) owner?: Owner;
    }

    expect(getMeta(Owned).relations['owner']!.entity!()).toBe(Owner);
    expect(getMeta(Owned).relations['owner']!.cardinality).toBe('m1');
    expect(getMeta(Owner).relations['owned']!.cardinality).toBe('1m');
  });

  it('applies @Index stacked above @Entity', () => {
    @Index(['title'], { unique: true })
    @Entity()
    class Indexed {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) title?: string;
    }

    // Class decorators apply bottom-up in both specs, so `@Entity()` finalizes before `@Index` appends.
    expect(getMeta(Indexed).indexes).toMatchObject([{ columns: [{ column: 'title' }], unique: true }]);
  });

  /**
   * The portability guarantee, tested directly rather than through a transformer.
   *
   * tsc, esbuild, Babel and Bun all prototype-chain a subclass's `context.metadata` to its parent's;
   * SWC alone does not. Both of this repo's suites run on chaining transformers, so an implementation
   * that secretly read through the chain would still pass every other test here. This builds the
   * unchained shape SWC emits and asserts inheritance resolves anyway, through the class prototype
   * chain that every transformer agrees on.
   */
  it('resolves inheritance with no metadata prototype chain', () => {
    class Base {}
    class Child extends Base {}

    const baseMetadata = Object.create(null) as DecoratorMetadata;
    const childMetadata = Object.create(null) as DecoratorMetadata;
    expect(Object.getPrototypeOf(childMetadata)).toBeNull();

    memberRegistrations(baseMetadata).fields['id'] = { type: Number, isId: true };
    memberRegistrations(childMetadata).fields['name'] = { type: String };
    Object.defineProperty(Base, Symbol.metadata, { value: baseMetadata, configurable: true });
    Object.defineProperty(Child, Symbol.metadata, { value: childMetadata, configurable: true });

    applyMembers(Child, drainRegistrations(childMetadata));
    defineEntity(Child);

    const meta = getMeta(Child);
    expect(Object.keys(meta.fields)).toEqual(['id', 'name']);
    expect(meta.id).toBe('id');
  });

  // The compile-time guard is covered by `type/entityOptions.test-d.ts`; this is the runtime backstop
  // for callers reaching `defineField` from plain JavaScript, where no such guard exists.
  it('refuses a field with no type and nothing to resolve one from', () => {
    class Untyped {
      mystery?: string;
    }
    expect(() => defineField(Untyped, 'mystery', {})).toThrow(/needs a 'type'/);
  });

  it('refuses a relation with no entity getter', () => {
    class NoTarget {
      other?: unknown;
    }
    // The type makes `entity` mandatory; the guard is what a JavaScript caller hits.
    // @ts-expect-error - deliberately omitted
    expect(() => defineRelation(NoTarget, 'other', { cardinality: 'm1' })).toThrow(/needs an 'entity' getter/);
  });
});
