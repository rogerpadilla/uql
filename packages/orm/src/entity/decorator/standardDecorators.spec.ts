import { describe, expect, it } from 'vitest';
import { untypedColumn } from '../../test/spec.util.js';
import type { HookContext } from '../../type/index.js';
import { BeforeInsert, Entity, f, Field, getMeta, ManyToOne, OneToMany } from '../index.js';
import { registerEntity } from '../metadata/definition.js';
import { drainRegistrations, memberRegistrations } from './bag.js';

/**
 * The TC39 decorator path, on the cases that would fail silently. Member decorators record on
 * `context.metadata` for the class decorator to drain, and inheritance is resolved through the class
 * prototype chain, since SWC does not chain a subclass's metadata to its parent's.
 */
describe('standard decorators', () => {
  it('should register fields, the id and the entity name', () => {
    @Entity()
    class Basic {
      @Field(f.number().id()) id?: number;
      @Field(f.string().nullable()) title?: string | null;
    }

    const meta = getMeta(Basic);
    expect(meta.name).toBe('Basic');
    expect(meta.ids.length).toBe(1);
    expect(meta.ids[0]).toBe('id');
    expect(Object.keys(meta.fields)).toEqual(['id', 'title']);
    expect(meta.fields['title']?.type).toBe(String);
  });

  it('should inherit fields from an undecorated abstract base, parent fields first', () => {
    abstract class Base {
      @Field(f.number().id()) id?: number;
      @Field(f.date().nullable()) createdAt?: Date | null;
    }

    @Entity()
    class Child extends Base {
      @Field(f.string().nullable()) name?: string | null;
    }

    const meta = getMeta(Child);
    // Order matters: it decides generated DDL column order.
    expect(Object.keys(meta.fields)).toEqual(['id', 'createdAt', 'name']);
    expect(meta.ids[0]).toBe('id');
  });

  it('should keep sibling subclasses of one base independent', () => {
    abstract class Shared {
      @Field(f.number().id()) id?: number;
    }

    @Entity()
    class Left extends Shared {
      @Field(f.string().nullable()) leftOnly?: string | null;
    }

    @Entity()
    class Right extends Shared {
      @Field(f.number().nullable()) rightOnly?: number | null;
    }

    // A bag that copied its parent's map, or mutated a shared one, would leak these into each other.
    expect(Object.keys(getMeta(Left).fields)).toEqual(['id', 'leftOnly']);
    expect(Object.keys(getMeta(Right).fields)).toEqual(['id', 'rightOnly']);
  });

  it('should register an inherited hook exactly once', () => {
    abstract class HookedBase {
      @Field(f.number().id()) id?: number;

      @BeforeInsert()
      stamp(_ctx: HookContext) {}
    }

    @Entity()
    class HookedChild extends HookedBase {
      @Field(f.string().nullable()) name?: string | null;
    }

    // Both the bag drain and `extendMeta` see this hook; only one of them may register it.
    expect(getMeta(HookedChild).hooks?.beforeInsert).toMatchObject([{ methodName: 'stamp' }]);
  });

  it('should register relations from the entity getter', () => {
    @Entity()
    class Owner {
      @Field(f.number().id()) id?: number;
      @OneToMany({ entity: () => Owned, mappedBy: (owned) => owned.owner }) owned?: Owned[];
    }

    @Entity()
    class Owned {
      @Field(f.number().id()) id?: number;
      @Field(f.references(() => Owner).nullable()) ownerId?: number | null;
      @ManyToOne({ entity: () => Owner, references: (owned) => owned.ownerId }) owner?: Owner;
    }

    expect(getMeta(Owned).relations['owner']?.entity?.()).toBe(Owner);
    expect(getMeta(Owned).relations['owner']?.cardinality).toBe('m1');
    expect(getMeta(Owner).relations['owned']?.cardinality).toBe('1m');
  });

  it('should apply @Index stacked above @Entity', () => {
    @Entity({ indexes: (indexed, index) => [index([indexed.title], { unique: true })] })
    class Indexed {
      @Field(f.number().id()) id?: number;
      @Field(f.string().nullable()) title?: string | null;
    }

    // Class decorators apply bottom-up in both specs, so `@Entity()` finalizes before `@Index` appends.
    expect(getMeta(Indexed).indexes).toMatchObject([{ entries: [{ column: 'title' }], unique: true }]);
  });

  /**
   * The unchained metadata SWC emits, built by hand: both suites here run on transformers that chain it,
   * so this is the one case showing inheritance resolves through the class prototype chain alone.
   */
  it('should resolve inheritance with no metadata prototype chain', () => {
    class Base {}
    class Child extends Base {}

    const baseMetadata: DecoratorMetadata = Object.create(null);
    const childMetadata: DecoratorMetadata = Object.create(null);
    expect(Object.getPrototypeOf(childMetadata)).toBeNull();

    memberRegistrations(baseMetadata).fields['id'] = { type: Number, isId: true };
    memberRegistrations(childMetadata).fields['name'] = { type: String };
    Object.defineProperty(Base, Symbol.metadata, { value: baseMetadata, configurable: true });
    Object.defineProperty(Child, Symbol.metadata, { value: childMetadata, configurable: true });

    registerEntity(Child, {}, drainRegistrations(childMetadata));

    const meta = getMeta(Child);
    expect(Object.keys(meta.fields)).toEqual(['id', 'name']);
    expect(meta.ids[0]).toBe('id');
  });

  // The compile-time guards are the decorators' types; these are the runtime backstops a JavaScript caller hits.
  it('should refuse a field with no type and nothing to resolve one from', () => {
    expect(() => {
      @Entity()
      class Untyped {
        @Field(f.number().id()) id?: number;
        @Field(untypedColumn({})) mystery?: string | null;
      }
      return Untyped;
    }).toThrow(/needs a 'type'/);
  });

  it('should refuse a relation with no entity getter', () => {
    expect(() => {
      @Entity()
      class NoTarget {
        @Field(f.number().id()) id?: number;
        // @ts-expect-error deliberately omitted
        @ManyToOne({}) other?: NoTarget;
      }
      return NoTarget;
    }).toThrow(/needs an 'entity' getter/);
  });
});
