import { expect, it } from 'vitest';
import { sql } from '../../util/index.js';
import { Entity, f, Field, ManyToOne } from '../index.js';
import { defineEntity, getMeta, removeEntity } from './definition.js';
import { Dog } from './schemaFixture/animal.js';
import { Author } from './schemaFixture/author.js';
import { Book } from './schemaFixture/book.js';

it('should register the class a schema declares, its relations once first read', () => {
  expect(getMeta(Author)).toMatchObject({ name: 'Author', ids: ['id'] });
  expect(Object.keys(getMeta(Book).relations)).toEqual(['author']);
});

it('should inherit the columns of the entity it extends', () => {
  expect(Object.keys(getMeta(Dog).fields)).toEqual(['id', 'name', 'tricks']);
  expect(getMeta(Dog).ids).toEqual(['id']);
});

it('should register each relation kind the builder declares, and an async hook of a schema', async () => {
  const Junction = defineEntity({
    name: 'Junction',
    fields: {
      id: f.number().id(),
      parentId: f.number(),
      dogId: f.number(),
    },
  }).relations((rel) => ({
    parent: () => rel.manyToOne(Parent, { references: (junction) => junction.parentId }),
    dog: () => rel.manyToOne(Dog, { references: (junction) => junction.dogId }),
  }));

  const Parent = defineEntity({
    name: 'Parent',
    fields: { id: f.number().id() },
  })
    .hooks({ beforeInsert: [async (parent) => void (await Promise.resolve(parent))] })
    .relations((rel) => ({
      one: () => rel.oneToOne(Dog, { references: (parent) => parent.id }),
      many: () => rel.manyToMany(Dog, { through: () => Junction }),
    }));

  expect(Object.keys(getMeta(Parent).relations).sort()).toEqual(['many', 'one']);
  expect(getMeta(Parent).hooks?.beforeInsert?.[0]?.run).toBeTypeOf('function');
});

it("should register a schema's table schema, filters and triggers", () => {
  const Post = defineEntity({
    name: 'Post',
    schema: 'blog',
    fields: { id: f.number().id(), title: f.string().nullable(), live: f.boolean().nullable() },
  })
    .triggers((post, trigger) => [trigger({ on: 'beforeUpdate', of: [post.title], run: () => sql`select 1` })])
    .filters({ live: { where: { live: true } } });

  expect(getMeta(Post)).toMatchObject({ schema: 'blog', filters: { live: { where: { live: true } } } });
  expect(getMeta(Post).triggers).toMatchObject([{ on: 'beforeUpdate', of: ['title'] }]);
});

/** A base's relations reach every entity extending it, whichever of them is read first. */
it("should inherit a schema base's relations, read before or after the base", () => {
  const Owner = defineEntity({ name: 'Owner', fields: { id: f.number().id() } });
  const Pet = defineEntity({
    name: 'Pet',
    fields: { id: f.number().id(), ownerId: f.number().nullable() },
  }).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (pet) => pet.ownerId }) }));
  const Cat = defineEntity({ name: 'Cat', extends: Pet, fields: { lives: f.number().nullable() } });
  @Entity()
  class Hound extends Pet {
    @Field(f.string().nullable()) breed?: string | null;
  }

  expect(Object.keys(getMeta(Cat).relations)).toEqual(['owner']);
  expect(Object.keys(getMeta(Hound).relations)).toEqual(['owner']);
  expect(Object.keys(getMeta(Pet).relations)).toEqual(['owner']);
  expect(getMeta(Cat).relations.owner?.references).toEqual([{ local: 'ownerId', foreign: 'id' }]);
});

it('should answer a removed schema as no entity', () => {
  const Owner = defineEntity({ name: 'Owner', fields: { id: f.number().id() } });
  const Gone = defineEntity({
    name: 'Gone',
    fields: { id: f.number().id(), ownerId: f.number().nullable() },
  }).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (gone) => gone.ownerId }) }));

  removeEntity(Gone);

  expect(() => getMeta(Gone)).toThrow("'Gone' is not an entity");
});

/** An entity declaring a relation its base declares too keeps its own. */
it("should keep an entity's own relation over its schema base's", () => {
  const Owner = defineEntity({ name: 'Owner', fields: { id: f.number().id() } });
  const Pet = defineEntity({
    name: 'Pet',
    fields: { id: f.number().id(), ownerId: f.number().nullable() },
  }).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (pet) => pet.ownerId }) }));
  const Foster = defineEntity({
    name: 'Foster',
    extends: Pet,
    fields: { fosterId: f.number().nullable() },
  }).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (foster) => foster.fosterId }) }));

  expect(getMeta(Foster).relations.owner?.references).toEqual([{ local: 'fosterId', foreign: 'id' }]);
});

it("should keep a schema's own relation over its decorated base's", () => {
  const Keeper = defineEntity({ name: 'Keeper', fields: { id: f.number().id() } });
  type Keeper = InstanceType<typeof Keeper>;
  @Entity()
  class Stall {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Keeper).nullable()) keeperId?: number | null;
    @ManyToOne({ entity: () => Keeper, references: (stall) => stall.keeperId }) keeper?: Keeper;
  }
  const Pen = defineEntity({ name: 'Pen', extends: Stall, fields: { minderId: f.number().nullable() } }).relations(
    (rel) => ({ keeper: () => rel.manyToOne(Keeper, { references: (pen) => pen.minderId }) }),
  );

  expect(getMeta(Pen).relations['keeper']?.references).toEqual([{ local: 'minderId', foreign: 'id' }]);
  expect(getMeta(Stall).relations.keeper?.references).toEqual([{ local: 'keeperId', foreign: 'id' }]);
});

it('should map a one-to-many naming no options by the one relation of its target pointing back', () => {
  const Hive = defineEntity({
    name: 'Hive',
    fields: { id: f.number().id() },
  }).relations((rel) => ({ bees: () => rel.oneToMany(Bee) }));
  const Bee = defineEntity({
    name: 'Bee',
    fields: { id: f.number().id(), hiveId: f.number().nullable() },
  }).relations((rel) => ({ hive: () => rel.manyToOne(Hive, { references: (bee) => bee.hiveId }) }));

  expect(getMeta(Hive).relations.bees).toMatchObject({
    mappedBy: 'hive',
    references: [{ local: 'id', foreign: 'hiveId' }],
  });
});

/** A schema built from data at run time reaches here without the types' check. */
it('should refuse a foreign key whose type holds another kind of value than the key it references', () => {
  const Badge = defineEntity({ name: 'Badge', fields: { id: f.string().id() } });
  const Wearer = defineEntity({
    name: 'Wearer',
    fields: { id: f.number().id(), badgeId: f.number().nullable() },
  }).relations((rel) => ({
    // @ts-expect-error a number column cannot hold the text key of the badge it points at
    badge: () => rel.manyToOne(Badge, { references: (wearer) => wearer.badgeId }),
  }));

  expect(() => getMeta(Wearer)).toThrow(
    "'Wearer.badge' holds a number, but the key of 'Badge' it references is a string",
  );
});

it('should take a BigInt foreign key over a numeric key, which it widens', () => {
  const Ledger = defineEntity({ name: 'Ledger', fields: { id: f.number().id() } });
  const Entry = defineEntity({
    name: 'Entry',
    fields: { id: f.number().id(), ledgerId: f.bigint().nullable() },
  }).relations((rel) => ({
    ledger: () => rel.manyToOne(Ledger, { references: (entry) => entry.ledgerId }),
  }));

  expect(getMeta(Entry).fields.ledgerId?.type).toBe(BigInt);
});

/** An entity declaring an aggregate its base declares too keeps its own. */
it("should keep an entity's own aggregate over its schema base's", () => {
  const Kennel = defineEntity({
    name: 'Kennel',
    fields: { id: f.number().id() },
  }).relations(
    (rel) => ({ pups: () => rel.oneToMany(Pup, { mappedBy: (pup) => pup.kennel }) }),
    (kennel) => ({ pupStat: () => kennel.pups.count() }),
  );
  const Pup = defineEntity({
    name: 'Pup',
    fields: { id: f.number().id(), age: f.number().nullable(), kennelId: f.number().nullable() },
  }).relations((rel) => ({ kennel: () => rel.manyToOne(Kennel, { references: (pup) => pup.kennelId }) }));
  const Shelter = defineEntity({
    name: 'Shelter',
    extends: Kennel,
    fields: {},
  }).relations(
    () => ({}),
    (shelter) => ({ pupStat: () => shelter.pups.max((pup) => pup.age) }),
  );

  expect(getMeta(Shelter).fields.pupStat?.computed).toMatchObject({ spec: { op: '$max', field: 'age' } });
  expect(getMeta(Kennel).fields.pupStat?.computed).toMatchObject({ spec: { op: '$count' } });
});

/** A derived field the registry cannot read as a column or an aggregate is refused on first read, not stored. */
it('should refuse a derived field that is neither a column nor an aggregate, on first read', () => {
  const Tally = defineEntity({ name: 'Tally', fields: { id: f.number().id() } }).relations(
    () => ({}),
    // @ts-expect-error a derived field is a thunk of a column or an aggregate, never a plain value
    () => ({ total: () => 1 }),
  );
  expect(() => getMeta(Tally)).toThrow("'Tally.total' is neither a column nor an aggregate: declare it as one");
  removeEntity(Tally);
});

it('should refuse a derived field that is no thunk, on first read', () => {
  const Tally = defineEntity({ name: 'Tally', fields: { id: f.number().id() } }).relations(
    () => ({}),
    // @ts-expect-error a derived field is a thunk, read lazily, never a plain value
    () => ({ total: 1 }),
  );
  expect(() => getMeta(Tally)).toThrow("'Tally.total' is neither a column nor an aggregate: declare it as one");
  removeEntity(Tally);
});
