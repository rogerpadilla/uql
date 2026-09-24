import { expect, it } from 'vitest';
import {
  assertDefined,
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  ItemTag,
  LedgerAccount,
  MeasureUnit,
  MeasureUnitCategory,
  Profile,
  Storehouse,
  Tag,
  Tax,
  TaxCategory,
  User,
  UserWithNonUpdatableId,
} from '../../test/index.js';
import { type EntityMeta, type IdKey, RAW_VALUE, RelationAggregate, idKey, type Type } from '../../type/index.js';
import { getKeys, raw } from '../../util/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { Entity, Field, Filter, Id, ManyToMany, ManyToOne, OneToMany } from '../index.js';
import {
  assertSoleId,
  defineEntity,
  defineField,
  defineFilter,
  defineHook,
  defineId,
  defineRelation,
  fieldOf,
  getEntities,
  getMeta,
  idOf,
  relationOf,
} from './definition.js';

it('should pass over a member given as undefined', () => {
  class Sparse {
    id?: number;
    note?: string;
    parent?: Sparse;
  }
  const meta = defineEntity(Sparse, {
    fields: { id: { type: Number, isId: true }, note: undefined },
    relations: { parent: undefined },
  });
  expect(getKeys(meta.fields)).toEqual(['id']);
  expect(meta.relations).toEqual({});
});

it('should name an entity that declares no primary key', () => {
  class Keyless {}
  const meta = defineField(Keyless, 'name', { type: String });
  expect(() => assertSoleId(meta, 'a key lookup')).toThrow("'Keyless' has no primary key, which a key lookup needs.");
});

it('should name the columns of a composite key, and name its row by every one', () => {
  @Entity()
  class Seat {
    [idKey]?: 'row' | 'number';
    @Id({ type: String }) row?: string;
    @Id({ type: Number }) number?: number;
    @Field({ type: String }) holder?: string | null;
  }
  const meta = getMeta(Seat);
  expect(() => assertSoleId(meta, 'a key lookup')).toThrow(
    "'Seat' has a composite primary key (row, number), which a key lookup does not support yet.",
  );
  expect(idOf(meta, { row: 'F', number: 12, holder: 'Ada' })).toEqual({ row: 'F', number: 12 });
});

it('should name the field it reads, and refuse one the entity does not declare', () => {
  const meta = getMeta(User);
  expect(fieldOf(meta, 'name')).toBe(meta.fields.name);
  // Outside the types, which name a field; the throw is for a key that reached it untyped.
  expect(() => fieldOf(meta, 'nope')).toThrow("'User' has no field 'nope'");
  expect(() => fieldOf(meta, 'nope')).toThrow(UqlUsageError);
});

it('should name the relation it reads, and refuse one the entity does not declare', () => {
  const meta = getMeta(User);
  expect(relationOf(meta, 'company')).toBe(meta.relations.company);
  // Outside the types, which name a relation; the throw is for a key that reached it untyped.
  // @ts-expect-error: `name` is a field
  expect(() => relationOf(meta, 'name')).toThrow("'User' has no relation 'name'");
});

it('should keep a check constraint as authored, for the schema build to render', () => {
  class Stocked {
    id?: number;
    quantity?: number | null;
  }
  const checks = [{ name: 'quantity_positive', where: raw`quantity > 0` }, { where: raw`quantity < 1000` }];
  const meta = defineEntity(Stocked, {
    fields: { id: { type: Number, isId: true }, quantity: { type: Number } },
    checks,
  });
  expect(meta.checks).toEqual(checks);
});

it('should refuse a field option the column type does not take', () => {
  class Conflicted {}
  expect(() => defineField(Conflicted, 'amount', { type: Number, length: 10 })).toThrow(
    "'Conflicted.amount' cannot use 'length': it applies to a string column, not to a numeric one.",
  );
});

it('should refuse a dotted entity name, pointing at the schema option', () => {
  class Dotted {}
  expect(() => defineEntity(Dotted, { name: 'crm.users', fields: { id: { type: Number, isId: true } } })).toThrow(
    "'Dotted' has a dotted name 'crm.users'. Name the schema separately as { schema: 'crm', name: 'users' }.",
  );
});

it('should keep the columns an inverse side names itself', () => {
  @Entity()
  class Shelf {
    @Id({ type: Number }) id?: number;
    @OneToMany({
      entity: () => Book,
      mappedBy: (book) => book.shelf,
      references: (shelf, book) => [{ local: shelf.id, foreign: book.shelfRef }],
    })
    books?: Book[];
  }
  @Entity()
  class Book {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Shelf }) shelfRef?: number | null;
    @ManyToOne({ entity: () => Shelf, references: (book, shelf) => [{ local: book.shelfRef, foreign: shelf.id }] })
    shelf?: Shelf;
  }
  expect(getMeta(Shelf).relations.books?.references).toEqual([{ local: 'id', foreign: 'shelfRef' }]);
});

it('should keep a foreign key column a column, with no relation it did not declare', () => {
  @Entity()
  class Warehouse {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Pallet {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Warehouse }) warehouseId?: number | null;
  }
  const meta = getMeta(Pallet);
  expect(meta.relations).toEqual({});
  expect(meta.fields.warehouseId?.references?.()).toBe(Warehouse);
});

it('should take a junction column as the one referencing its side, whatever either is called', () => {
  @Entity()
  class Course {
    @Id({ type: Number, name: 'course_pk' }) id?: number;
    @ManyToMany({ entity: () => Student, through: () => Enrolment }) students?: Student[];
  }
  @Entity()
  class Student {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Enrolment {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Course }) course?: number | null;
    @Field({ references: () => Student }) learner?: number | null;
  }
  expect(getMeta(Course).relations.students?.references).toEqual([
    { local: 'course', foreign: 'id' },
    { local: 'learner', foreign: 'id' },
  ]);
});

it('should register the User metadata', () => {
  const meta = getMeta(User);

  expect(meta.fields.companyId?.references?.()).toBe(Company);
  expect(meta.relations.company?.entity?.()).toBe(Company);
  expect(meta.relations.company?.references).toEqual([{ local: 'companyId', foreign: 'id' }]);

  expect(meta.fields.creatorId?.references?.()).toBe(User);
  expect(meta.relations.creator?.entity?.()).toBe(User);
  expect(meta.relations.creator?.references).toEqual([{ local: 'creatorId', foreign: 'id' }]);

  const expectedMeta = {
    entity: User,
    name: 'User',
    ids: ['id'] as const,
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      email: { name: 'email', type: String, updatable: false },
      password: { name: 'password', eager: false, type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      users: {
        cardinality: '1m',
        entity: expect.anything(),
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
      profile: {
        cardinality: '11',
        cascade: true,
        entity: expect.anything(),
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
    },
  } satisfies Partial<EntityMeta<User>>;

  expect(meta).toMatchObject(expectedMeta);
});

it('should register the Profile metadata', () => {
  const meta = getMeta(Profile);
  const expectedMeta = {
    entity: Profile,
    name: 'user_profile',
    ids: ['pk' as IdKey<Profile>],
    processedAt: expect.any(Number),
    fields: {
      pk: { name: 'pk', type: String, isId: true as const, onInsert: expect.anything() },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      picture: { name: 'image', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: '11',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<Profile>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the Item metadata', () => {
  const meta = getMeta(Item);
  const expectedMeta = {
    entity: Item,
    name: 'Item',
    ids: ['id' as const],
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
      code: { name: 'code', type: String },
      buyLedgerAccountId: {
        name: 'buyLedgerAccountId',
        references: expect.anything(),
      },
      saleLedgerAccountId: {
        name: 'saleLedgerAccountId',
        references: expect.anything(),
      },
      taxId: {
        name: 'taxId',
        references: expect.anything(),
      },
      measureUnitId: {
        name: 'measureUnitId',
        references: expect.anything(),
      },
      salePrice: { name: 'salePrice', type: Number },
      inventoryable: { name: 'inventoryable', type: Boolean },
      tagsCount: {
        name: 'tagsCount',
        // The aggregate is what types the field, so it declares none of its own.
        computed: expect.any(RelationAggregate),
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'buyLedgerAccountId', foreign: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'saleLedgerAccountId', foreign: 'id' }],
      },
      tax: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'taxId', foreign: 'id' }],
      },
      measureUnit: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'measureUnitId', foreign: 'id' }],
      },
      tags: {
        cardinality: 'mm',
        cascade: true,
        entity: expect.anything(),
        through: expect.anything(),
        references: [
          { local: 'itemId', foreign: 'id' },
          { local: 'tagId', foreign: 'id' },
        ],
      },
    },
  } satisfies Partial<EntityMeta<Item>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the Tag metadata', () => {
  const meta = getMeta(Tag);
  const expectedMeta = {
    entity: Tag,
    ids: ['id' as const],
    name: 'Tag',
    processedAt: expect.any(Number),
    fields: {
      id: {
        isId: true as const,
        name: 'id',
        type: String,
        onInsert: expect.anything(),
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      createdAt: {
        name: 'createdAt',
        onInsert: expect.anything(),
        type: Number,
      },
      name: {
        name: 'name',
        type: String,
      },
      itemsCount: {
        name: 'itemsCount',
        computed: expect.objectContaining({
          [RAW_VALUE]: expect.any(Function),
          spec: { relation: 'items', op: '$count' },
        }),
      },
      updatedAt: {
        name: 'updatedAt',
        onUpdate: expect.anything(),
        type: Number,
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      items: {
        cardinality: 'mm',
        entity: expect.anything(),
        mappedBy: 'tags',
        through: expect.anything(),
        references: [
          { local: 'tagId', foreign: 'id' },
          { local: 'itemId', foreign: 'id' },
        ],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<Tag>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the ItemTag metadata', () => {
  const meta = getMeta(ItemTag);
  const expectedMeta = {
    entity: ItemTag,
    name: 'ItemTag',
    ids: ['id' as const],
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      itemId: {
        name: 'itemId',
        references: expect.anything(),
      },
      tagId: {
        name: 'tagId',
        references: expect.anything(),
      },
    },
  } satisfies Partial<EntityMeta<ItemTag>>;
  expect(meta).toMatchObject(expectedMeta);
  expect(meta.relations).toEqual({});
});

it('should register the TaxCategory metadata', () => {
  const meta = getMeta(TaxCategory);
  const expectedMeta = {
    entity: TaxCategory,
    name: 'TaxCategory',
    ids: ['pk' as const],
    processedAt: expect.any(Number),
    fields: {
      pk: { name: 'pk', type: String, isId: true as const, onInsert: expect.anything() },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<TaxCategory>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the Tax metadata', () => {
  const meta = getMeta(Tax);
  const expectedMeta = {
    entity: Tax,
    name: 'Tax',
    ids: ['id' as const],
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      categoryId: {
        name: 'categoryId',
        references: expect.anything(),
      },
      percentage: {
        name: 'percentage',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      category: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [
          {
            local: 'categoryId',
            foreign: 'pk',
          },
        ],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<Tax>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the ItemAdjustment metadata', () => {
  const meta = getMeta(ItemAdjustment);
  const expectedMeta = {
    entity: ItemAdjustment,
    name: 'ItemAdjustment',
    ids: ['id' as const],
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      buyPrice: {
        name: 'buyPrice',
        type: Number,
      },
      inventoryAdjustmentId: {
        name: 'inventoryAdjustmentId',
        references: expect.anything(),
      },
      itemId: {
        name: 'itemId',
        references: expect.anything(),
      },
      number: {
        name: 'number',
        type: Number,
      },
      storehouseId: {
        name: 'storehouseId',
        references: expect.anything(),
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
    },
    relations: {
      storehouse: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'storehouseId', foreign: 'id' }],
      },
      item: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      inventoryAdjustment: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [
          {
            local: 'inventoryAdjustmentId',
            foreign: 'id',
          },
        ],
      },
    },
  } satisfies Partial<EntityMeta<ItemAdjustment>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the InventoryAdjustment metadata', () => {
  const meta = getMeta(InventoryAdjustment);
  const expectedMeta = {
    entity: InventoryAdjustment,
    name: 'InventoryAdjustment',
    ids: ['id' as const],
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      description: { name: 'description', type: String },
      date: { name: 'date', type: Date },
    },
    relations: {
      itemAdjustments: {
        cardinality: '1m',
        cascade: true,
        entity: expect.anything(),
        mappedBy: 'inventoryAdjustment',
        references: [{ local: 'id', foreign: 'inventoryAdjustmentId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<InventoryAdjustment>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the MeasureUnitCategory metadata', () => {
  const meta = getMeta(MeasureUnitCategory);
  const expectedMeta = {
    entity: MeasureUnitCategory,
    name: 'MeasureUnitCategory',
    ids: ['id' as const],
    softDelete: 'deletedAt' as const,
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      name: { name: 'name', type: String },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      deletedAt: { name: 'deletedAt', type: Number },
    },
    relations: {
      measureUnits: {
        cardinality: '1m',
        entity: expect.anything(),
        mappedBy: 'categoryId',
        references: [{ local: 'id', foreign: 'categoryId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<MeasureUnitCategory>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should register the MeasureUnit metadata', () => {
  const meta = getMeta(MeasureUnit);
  const expectedMeta = {
    entity: MeasureUnit,
    name: 'MeasureUnit',
    ids: ['id' as const],
    softDelete: 'deletedAt' as const,
    processedAt: expect.any(Number),
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      name: { name: 'name', type: String },
      categoryId: {
        name: 'categoryId',
        references: expect.anything(),
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      deletedAt: { name: 'deletedAt', type: Number },
    },
    relations: {
      category: {
        cardinality: 'm1',
        cascade: 'persist',
        entity: expect.anything(),
        references: [{ local: 'categoryId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<MeasureUnit>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('should refuse metadata for a class that is no entity', () => {
  class SomeClass {}

  expect(() => {
    getMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    id!: string;
  }

  expect(() => getMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});

it('should list every registered entity', () => {
  const entities = getEntities();
  expect(entities.length).toBeGreaterThanOrEqual(15);
  expect(entities).toEqual(
    expect.arrayContaining([
      Company,
      Profile,
      User,
      LedgerAccount,
      TaxCategory,
      Tax,
      MeasureUnitCategory,
      MeasureUnit,
      Storehouse,
      Item,
      Tag,
      ItemTag,
      ItemAdjustment,
      InventoryAdjustment,
      UserWithNonUpdatableId,
    ]),
  );
});

it('should refuse an entity with no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field({ type: String })
      id!: string | null;
    }
    return SomeEntity;
  }).toThrow(
    `'SomeEntity' must have at least one id field (use @Id, defineId, or defineEntity({ fields: { ..., isId: true } }))`,
  );
});

it('should refuse an entity with no fields', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id!: string;
    }
    return SomeEntity;
  }).toThrow(`'SomeEntity' must have fields`);
});

it("should join a one-to-many through a junction by the junction's columns", () => {
  @Entity()
  class Author {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class BookAuthor {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number, references: () => Author })
    authorId?: number | null;
    @Field({ type: Number, references: () => Book })
    bookId?: number | null;
  }

  @Entity()
  class Book {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Author, through: () => BookAuthor })
    authors?: Author[];
  }

  const meta = getMeta(Book);

  expect(meta.relations.authors?.references).toEqual([
    { local: 'bookId', foreign: 'id' },
    { local: 'authorId', foreign: 'id' },
  ]);
});

it('should refuse a to-many relation with no way to join', () => {
  @Entity()
  class Chapter {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  expect(() => {
    @Entity()
    class Novel {
      @Field({ type: Number, isId: true })
      id?: number;
      // @ts-expect-error the type rejects it too; this covers the runtime guard for untyped callers
      @ManyToMany({ entity: () => Chapter })
      chapters?: Chapter[];
    }
    getMeta(Novel);
  }).toThrow(
    `'Novel.chapters' is a to-many relation with no way to join: it needs 'mappedBy' (the member on the other side), 'through' (a junction entity), or 'references' (the columns).`,
  );
});

it('should refuse a mappedBy naming neither a field nor a relation', () => {
  @Entity()
  class Track {
    @Field({ type: Number, isId: true })
    id?: number;
    undeclared?: string;
  }

  @Entity()
  class Album {
    @Field({ type: Number, isId: true })
    id?: number;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @OneToMany({ entity: () => Track, mappedBy: (track) => track.undeclared })
    tracks?: Track[];
  }

  expect(() => getMeta(Album)).toThrow(
    `'Album.tracks' is mapped by 'undeclared', which is neither a field nor a relation of 'Track'.`,
  );
});

it('should say which column to declare for a junction referencing no side', () => {
  @Entity()
  class Colour {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class ShirtColour {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number, references: () => Colour })
    colourId?: number | null;
  }

  @Entity()
  class Shirt {
    @Field({ type: Number, isId: true })
    id?: number;
    @ManyToMany({ entity: () => Colour, through: () => ShirtColour })
    colours?: Colour[];
  }

  expect(() => getMeta(Shirt)).toThrow(
    `'Shirt.colours' joins through 'ShirtColour', which has no column referencing 'Shirt.id': declare '@Field({ references: () => Shirt })'.`,
  );
});

it('should refuse a junction where two columns reference the same key', () => {
  @Entity()
  class Person {
    @Id({ type: Number }) id?: number;
    @ManyToMany({ entity: () => Person, through: () => Friendship }) friends?: Person[];
  }
  @Entity()
  class Friendship {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Person }) personId?: number | null;
    @Field({ references: () => Person }) friendId?: number | null;
  }

  expect(() => getMeta(Person)).toThrow(
    `'Person.friends' joins through 'Friendship', where 'personId' and 'friendId' each reference 'Person.id': a junction needs exactly one column per key of each side.`,
  );
});

it('should resolve a junction read first, even with an inverse side leading back through it', () => {
  @Entity()
  class Film {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Screening {
    @Id({ type: Number }) id?: number;
    // Ahead of the junction's own foreign key, and leading back through the junction.
    @OneToMany({ entity: () => Review, mappedBy: (review) => review.screening }) reviews?: Review[];
    @Field({ references: () => Film }) filmId?: number | null;
    @ManyToOne({ entity: () => Film, references: (screening) => screening.filmId }) film?: Film;
    @Field({ references: () => Review }) reviewId?: number | null;
  }
  @Entity()
  class Review {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Screening }) screeningId?: number | null;
    @ManyToOne({ entity: () => Screening, references: (review) => review.screeningId }) screening?: Screening;
    @ManyToMany({ entity: () => Film, through: () => Screening }) films?: Film[];
  }

  expect(getMeta(Screening).relations.reviews?.references).toEqual([{ local: 'id', foreign: 'screeningId' }]);
  expect(getMeta(Review).relations.films?.references).toEqual([
    { local: 'reviewId', foreign: 'id' },
    { local: 'filmId', foreign: 'id' },
  ]);
});

it('should resolve an inverse side through a junction whichever side is read first', () => {
  @Entity()
  class Genre {
    @Id({ type: Number }) id?: number;
    @ManyToMany({ entity: () => Album, mappedBy: (album) => album.genres }) albums?: Album[];
    @Field({ references: () => Album }) featuredId?: number | null;
    @ManyToOne({ entity: () => Album, references: (genre) => genre.featuredId }) featured?: Album;
  }
  @Entity()
  class Album {
    @Id({ type: Number }) id?: number;
    // Ahead of the relation `Genre.albums` is the inverse of, and leading to `Genre` first.
    @OneToMany({ entity: () => Genre, mappedBy: (genre) => genre.featured }) featuredBy?: Genre[];
    @ManyToMany({ entity: () => Genre, through: () => AlbumGenre }) genres?: Genre[];
  }
  @Entity()
  class AlbumGenre {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Album }) albumId?: number | null;
    @Field({ references: () => Genre }) genreId?: number | null;
  }

  expect(getMeta(Album).relations.featuredBy?.references).toEqual([{ local: 'id', foreign: 'featuredId' }]);
  expect(getMeta(Genre).relations.albums?.references).toEqual([
    { local: 'genreId', foreign: 'id' },
    { local: 'albumId', foreign: 'id' },
  ]);
});

it('should refuse a second softDelete field', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field({ type: String, isId: true })
      id!: string;
      @Field({ type: Number, softDelete: true })
      deletedAt?: number | null;
      @Field({ type: Date, softDelete: () => new Date() })
      archivedAt?: Date | null;
    }
    return SomeEntity;
  }).toThrow(`'SomeEntity' must have at most one field with 'softDelete'`);
});

it('should join a to-one on the foreign key its references name, whatever either is called', () => {
  @Entity()
  class Author {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Essay, mappedBy: (essay) => essay.author }) essays?: Essay[];
  }
  @Entity()
  class Essay {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Author }) writtenById?: number | null;
    @ManyToOne({ entity: () => Author, references: (essay) => essay.writtenById }) author?: Author;
  }

  expect(getMeta(Author).relations.essays?.references).toEqual([{ local: 'id', foreign: 'writtenById' }]);
  expect(getMeta(Essay).relations.author?.references).toEqual([{ local: 'writtenById', foreign: 'id' }]);
  expect(getKeys(getMeta(Essay).fields)).toEqual(['id', 'writtenById']);
});

it('should refuse a to-one naming no foreign key, on every read rather than handing back a half-resolved one', () => {
  @Entity()
  class Quay {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Barge {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Quay }) quayId?: number | null;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @ManyToOne({ entity: () => Quay }) quay?: Quay;
  }

  const refusal =
    "'Barge.quay' needs 'references', the foreign key column it joins by, or 'mappedBy', the member on the " +
    'other side holding it.';
  expect(() => getMeta(Barge)).toThrow(refusal);
  expect(() => getMeta(Barge)).toThrow(refusal);
});

it('should refuse a join on a member that is not a column of its entity', () => {
  @Entity()
  class Pier {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number, computed: raw`1` }) berthCount?: number | null;
  }
  class Tug {
    id?: number;
    pierId?: number;
    pier?: Pier;
  }
  defineEntity(Tug, { fields: { id: { type: Number, isId: true } } });
  defineRelation(Tug, 'pier', { cardinality: 'm1', entity: () => Pier, references: (tug) => tug.pierId });
  class Yacht {
    id?: number;
    pierId?: number | null;
    pier?: Pier;
  }
  defineEntity(Yacht, { fields: { id: { type: Number, isId: true }, pierId: { type: Number } } });
  defineRelation(Yacht, 'pier', {
    cardinality: 'm1',
    entity: () => Pier,
    references: (yacht, pier) => [{ local: yacht.pierId, foreign: pier.berthCount }],
  });

  expect(() => getMeta(Tug)).toThrow("'Tug.pier' joins 'Tug.pierId', which is not a column: declare it with '@Field'.");
  expect(() => getMeta(Yacht)).toThrow(
    "'Yacht.pier' joins 'Pier.berthCount', which is not a column: declare it with '@Field'.",
  );
});

it('should refuse a to-one whose foreign key references another entity', () => {
  @Entity()
  class Harbour {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Marina {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Ferry {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Marina }) harbourId?: number | null;
    @ManyToOne({ entity: () => Harbour, references: (ferry) => ferry.harbourId }) harbour?: Harbour;
  }

  expect(() => getMeta(Ferry)).toThrow(
    "'Ferry.harbour' joins 'Ferry.harbourId', a foreign key to 'Marina', not to 'Harbour'.",
  );
});

it('should refuse references naming one column for a composite key, which needs a column per key', () => {
  @Entity()
  class Locker {
    [idKey]?: 'row' | 'slot';
    @Id({ type: String }) row?: string;
    @Id({ type: Number }) slot?: number;
  }
  @Entity()
  class Rental {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) lockerRef?: string | null;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @ManyToOne({ entity: () => Locker, references: (rental) => rental.lockerRef }) locker?: Locker;
  }

  expect(() => getMeta(Rental)).toThrow(
    "'Rental.locker' names one column, 'lockerRef', which only a to-one holding a foreign key to a one-column key " +
      'can: pair the columns, [{ local, foreign }].',
  );
});

/** Types keep one column to the side of a to-one holding the key; this is the guard for a caller they cannot see. */
it('should refuse references naming one column on a relation that holds no foreign key', () => {
  class Dock {
    id?: number;
  }
  defineEntity(Dock, { fields: { id: { type: Number, isId: true } } });
  class Ship {
    id?: number;
    dockId?: number | null;
  }
  defineEntity(Ship, { fields: { id: { type: Number, isId: true }, dockId: { type: Number } } });
  const options = { cardinality: '1m', entity: () => Dock, references: () => 'dockId' };
  // @ts-expect-error: plain JavaScript
  defineRelation(Ship, 'docks', options);

  expect(() => getMeta(Ship)).toThrow(
    "'Ship.docks' names one column, 'dockId', which only a to-one holding a foreign key to a one-column key " +
      'can: pair the columns, [{ local, foreign }].',
  );
});

it('should join a relation a base class declares on its foreign key in every entity extending it', () => {
  @Entity()
  class Region {
    @Id({ type: Number }) id?: number;
  }
  abstract class Regional {
    @Field({ references: () => Region }) regionId?: number | null;
    @ManyToOne({ entity: () => Region, references: (regional) => regional.regionId }) region?: Region;
  }
  @Entity()
  class Office extends Regional {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Depot extends Regional {
    @Id({ type: Number }) id?: number;
  }

  expect(getMeta(Office).relations.region?.references).toEqual([{ local: 'regionId', foreign: 'id' }]);
  expect(getMeta(Depot).relations.region?.references).toEqual([{ local: 'regionId', foreign: 'id' }]);
});

it('should register the built-in softDelete filter from @Field({ softDelete })', () => {
  const meta = getMeta(MeasureUnit);
  expect(meta.filters?.['softDelete']).toEqual({ where: { deletedAt: null }, default: true });
});

it('should register @Filter and bulk filters', () => {
  @Filter('active', { where: { status: 'active' }, default: false })
  @Entity({ filters: { recent: { where: { status: 'new' } } } })
  class FilteredEntity {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    status?: string | null;
  }
  const meta = getMeta(FilteredEntity);
  expect(meta.filters?.['active']).toEqual({ where: { status: 'active' }, default: false });
  expect(meta.filters?.['recent']).toEqual({ where: { status: 'new' } });
});

it('should refuse softDelete as a filter name', () => {
  expect(() => {
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @Filter('softDelete', { where: { status: 'bogus' } })
    @Entity()
    class ReservedFilter {
      @Id({ type: Number })
      id?: number;
      @Field({ type: String })
      status?: string | null;
    }
    return ReservedFilter;
  }).toThrow("filter name 'softDelete' is reserved");
});

/**
 * A `security` filter is row-level security: `skip` would silently drop it whenever its condition
 * can't resolve (no context, missing tenant id), returning every row instead of none. It has to
 * fail closed, so the combination is rejected at registration rather than at query time.
 */
it('should refuse a security filter that skips when its condition is unresolved', () => {
  expect(() => {
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @Filter('tenant', { where: () => undefined, security: true, onMissing: 'skip' })
    @Entity()
    class SkippableSecurityFilter {
      @Id({ type: Number })
      id?: number;
    }
    return SkippableSecurityFilter;
  }).toThrow("security filter 'tenant' cannot use onMissing: 'skip' (it must fail closed)");
});

/** The last `@Id` wins, and the one it replaces stops being a field altogether. */
it('should make the primary key composite on a second @Id', () => {
  @Entity()
  class Membership {
    [idKey]?: 'userId' | 'groupId';
    @Id({ type: Number })
    userId?: number;
    @Id({ type: Number })
    groupId?: number;
    @Field({ type: String })
    role?: string | null;
  }

  const meta = getMeta(Membership);
  expect(meta.ids).toEqual(['userId', 'groupId']);
  expect(getKeys(meta.fields)).toEqual(['userId', 'groupId', 'role']);
  // Membership is the field's own flag, never a lookup in `ids`.
  expect(meta.fields.userId?.isId).toBe(true);
  expect(meta.fields.role?.isId).toBeUndefined();
});

/**
 * Both sides of a junction contribute one column per key, in their own order. The inverse side swaps
 * the two groups whole; reversing the array would pair a composite's columns crosswise.
 */
it('should pair every key of both sides in a junction, the inverse side swapping the groups', () => {
  @Entity()
  class Enrolment {
    [idKey]?: 'studentId' | 'courseId';
    @Id({ type: Number }) studentId?: number;
    @Id({ type: String }) courseId?: string;
    @ManyToMany({ entity: () => Badge, through: () => EnrolmentBadge })
    badges?: Badge[];
  }
  @Entity()
  class Badge {
    @Id({ type: Number }) id?: number;
    @ManyToMany({ entity: () => Enrolment, mappedBy: (enrolment) => enrolment.badges })
    enrolments?: Enrolment[];
  }
  @Entity()
  class EnrolmentBadge {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) enrolmentStudentId?: number | null;
    @Field({ type: String }) enrolmentCourseId?: string | null;
    @ManyToOne({
      entity: () => Enrolment,
      references: (enrolmentBadge, enrolment) => [
        { local: enrolmentBadge.enrolmentStudentId, foreign: enrolment.studentId },
        { local: enrolmentBadge.enrolmentCourseId, foreign: enrolment.courseId },
      ],
    })
    enrolment?: Enrolment;
    @Field({ references: () => Badge }) badgeId?: number | null;
  }

  expect(getMeta(Enrolment).relations.badges?.references).toEqual([
    { local: 'enrolmentStudentId', foreign: 'studentId' },
    { local: 'enrolmentCourseId', foreign: 'courseId' },
    { local: 'badgeId', foreign: 'id' },
  ]);
  expect(getMeta(Badge).relations.enrolments?.references).toEqual([
    { local: 'badgeId', foreign: 'id' },
    { local: 'enrolmentStudentId', foreign: 'studentId' },
    { local: 'enrolmentCourseId', foreign: 'courseId' },
  ]);
});

/** `mappedBy` names one column, which one key fits: guessing which of several would join wrong rows. */
it('should refuse an inverse relation mapped by a field when the key is composite', () => {
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) enrolmentStudentId?: number | null;
  }
  @Entity()
  class Enrolment {
    [idKey]?: 'studentId' | 'courseId';
    @Id({ type: Number }) studentId?: number;
    @Id({ type: String }) courseId?: string;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.enrolmentStudentId })
    notes?: Note[];
  }

  const error = getError(() => getMeta(Enrolment));
  expect(error).toContain(`'Enrolment.notes' is mapped by 'Note.enrolmentStudentId', one column`);
  expect(error).toContain('composite (studentId, courseId)');
});

/** The pair reads the same way round as every other: the parent's own key on the left. */
it('should pair an inverse relation mapped by a field from the parent side', () => {
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) ownerId?: number | null;
  }
  @Entity()
  class Owner {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.ownerId })
    notes?: Note[];
  }

  expect(getMeta(Owner).relations.notes?.references).toEqual([{ local: 'id', foreign: 'ownerId' }]);
});

/** A foreign key to another entity would join this key against that one's, returning unrelated rows. */
it('should refuse an inverse relation mapped by a field referencing another entity', () => {
  @Entity()
  class Reader {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Review {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Reader }) readerId?: number | null;
  }
  @Entity()
  class Critic {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Review, mappedBy: (review) => review.readerId })
    reviews?: Review[];
  }

  expect(() => getMeta(Critic)).toThrow(
    "'Critic.reviews' joins 'Review.readerId', a foreign key to 'Reader', not to 'Critic'.",
  );
});

it('should refuse a to-many joining columns whose foreign key, on the other side, references another entity', () => {
  @Entity()
  class Crew {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Sailor {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Crew }) crewId?: number | null;
  }
  @Entity()
  class Captain {
    @Id({ type: Number }) id?: number;
    @OneToMany({
      entity: () => Sailor,
      references: (captain, sailor) => [{ local: captain.id, foreign: sailor.crewId }],
    })
    sailors?: Sailor[];
  }

  expect(() => getMeta(Captain)).toThrow(
    "'Captain.sailors' joins 'Sailor.crewId', a foreign key to 'Crew', not to 'Captain'.",
  );
});

it('should refuse an inverse relation mapped by a relation to another entity', () => {
  @Entity()
  class Editor {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Draft {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) editorId?: number | null;
    @ManyToOne({ entity: () => Editor, references: (draft) => draft.editorId }) editor?: Editor;
  }
  @Entity()
  class Proofreader {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Draft, mappedBy: (draft) => draft.editor }) drafts?: Draft[];
  }

  expect(() => getMeta(Proofreader)).toThrow(
    "'Proofreader.drafts' is mapped by 'Draft.editor', a relation to 'Editor', not to 'Proofreader'.",
  );
});

it('should accept an inverse relation mapped by a field referencing the entity it inherits it from', () => {
  @Entity()
  class Shelf {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Volume, mappedBy: (volume) => volume.shelfId })
    volumes?: Volume[];
  }
  class Bookcase extends Shelf {
    label?: string | null;
  }
  defineEntity(Bookcase, { fields: { label: { type: String } } });
  @Entity()
  class Volume {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Shelf }) shelfId?: number | null;
  }

  expect(getMeta(Bookcase).relations.volumes?.references).toEqual([{ local: 'id', foreign: 'shelfId' }]);
});

/** The message a registration error carries, for a test that pins what it says and not how. */
function getError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  throw new Error('expected a registration error');
}

/** One column cannot reference a two-column key; the relation decorators make one column per key. */
it('should refuse a plain foreign key pointing at a composite key', () => {
  @Entity()
  class Enrolment {
    [idKey]?: 'studentId' | 'courseId';
    @Id({ type: Number }) studentId?: number;
    @Id({ type: String }) courseId?: string;
  }
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @Field({ references: () => Enrolment }) enrolmentStudentId?: number | null;
  }

  // The column, the key it cannot reach, and the decorator that can: the rest is wording.
  const error = getError(() => getMeta(Note));
  expect(error).toContain(`'Note.enrolmentStudentId'`);
  expect(error).toContain('composite (studentId, courseId)');
  expect(error).toContain("pair each with it in a '@ManyToOne' to 'Enrolment'");
});

/** Every column of the parent's key, or the ones it did not replace would widen the child's. */
it('should drop every key of a composite parent from a subclass declaring its own', () => {
  @Entity()
  class Pair {
    [idKey]?: 'left' | 'right';
    @Id({ type: Number }) left?: number;
    @Id({ type: Number }) right?: number;
    @Field({ type: String }) label?: string | null;
  }
  @Entity()
  class Single extends Pair {
    @Id({ type: Number }) id?: number;
  }

  const meta = getMeta(Single);
  expect(meta.ids).toEqual(['id']);
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'label']);
});

it('should inherit the parent fields in a subclass declaring the only @Id', () => {
  class IdlessBase {
    @Field({ type: String })
    name?: string | null;
  }

  @Entity()
  class IdentifiedChild extends IdlessBase {
    @Id({ type: Number })
    id?: number;
  }

  const meta = getMeta(IdentifiedChild);
  expect(meta.ids[0]).toBe('id');
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'name']);
});

it("should inherit the parent's softDelete field key and filters in a subclass", () => {
  @Filter('active', { where: { status: 'active' }, default: false })
  @Entity()
  class SoftBase {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    status?: string | null;
    @Field({ type: Date, softDelete: true })
    deletedAt?: Date | null;
  }

  @Entity()
  class SoftChild extends SoftBase {
    @Field({ type: String })
    name?: string | null;
  }

  const meta = getMeta(SoftChild);
  expect(meta.softDelete).toBe('deletedAt');
  expect(meta.filters?.['softDelete']).toEqual({ where: { deletedAt: null }, default: true });
  expect(meta.filters?.['active']).toEqual({ where: { status: 'active' }, default: false });
});

/**
 * `extends` is what a minted class cannot say by extending: the base is named in the options, and the
 * merge is the prototype chain's, ancestors included.
 */
it('should inherit through `extends` the fields, relations, hooks and filters of a base and its own base', () => {
  class Timestamped {
    createdAt?: Date;
    stamp(): void {}
  }
  defineField(Timestamped, 'createdAt', { type: Date });
  defineHook(Timestamped, 'stamp', 'beforeInsert');

  class Owned extends Timestamped {
    ownerId?: string;
    owner?: User;
  }
  defineField(Owned, 'ownerId', { type: String });
  defineRelation(Owned, 'owner', { cardinality: 'm1', entity: () => User, references: (owned) => owned.ownerId });
  defineFilter(Owned, 'mine', { where: { ownerId: 'u1' }, default: false });

  class Ticket {
    id?: number;
    title?: string | null;
    createdAt?: Date;
    ownerId?: string;
    owner?: User;
    stamp(): void {}
  }
  defineEntity(Ticket, {
    extends: Owned,
    fields: { id: { type: Number, isId: true }, title: { type: String } },
  });

  const meta = getMeta(Ticket);
  expect(getKeys(meta.fields).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title']);
  expect(meta.relations['owner']?.references).toEqual([{ local: 'ownerId', foreign: 'id' }]);
  expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'stamp' }]);
  expect(meta.filters?.['mine']).toEqual({ where: { ownerId: 'u1' }, default: false });
  expect(meta.ids).toEqual(['id']);
});

it('should keep a base named by extends in its own table, and the child what it declares itself', () => {
  class Auditable {
    id?: number;
    label?: string;
    archived?: boolean | null;
  }
  defineEntity(Auditable, {
    name: 'auditable',
    fields: {
      id: { type: Number, isId: true },
      label: { type: String, nullable: false },
      archived: { type: Boolean },
    },
  });

  class Invoice {
    [idKey]?: 'ref';
    ref?: string;
    label?: string;
    archived?: boolean | null;
  }
  defineEntity(Invoice, {
    extends: Auditable,
    fields: { ref: { type: String, isId: true }, label: { type: String, nullable: false } },
  });

  const meta = getMeta(Invoice);
  expect(meta.name).toBe('Invoice');
  expect(meta.ids).toEqual(['ref']);
  expect(getKeys(meta.fields).sort()).toEqual(['archived', 'label', 'ref']);
  expect(meta.fields['label']).toMatchObject({ type: String, nullable: false });
  expect(getMeta(Auditable).name).toBe('auditable');
});

it('should take the nearer base for a class that both extends and names one', () => {
  class Named {
    label?: string;
  }
  defineField(Named, 'label', { type: String, length: 10 });

  class Described {
    label?: string;
    note?: string;
  }
  defineField(Described, 'label', { type: String, length: 500 });
  defineField(Described, 'note', { type: String });

  class Asset extends Named {
    id?: number;
    note?: string;
  }
  defineEntity(Asset, { extends: Described, fields: { id: { type: Number, isId: true } } });

  const meta = getMeta(Asset);
  expect(meta.fields['label']).toMatchObject({ type: String, length: 10 });
  expect(meta.fields['note']).toMatchObject({ type: String });
});

it('should keep the relations a junction declares itself', () => {
  @Entity()
  class Screening {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class Note {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number })
    filmScreeningId?: number | null;
  }

  @Entity()
  class FilmScreening {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ references: () => Film })
    filmId?: number | null;
    @ManyToOne({ entity: () => Film, cascade: 'delete', references: (filmScreening) => filmScreening.filmId })
    film?: Film;
    @Field({ references: () => Screening })
    screeningId?: number | null;
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.filmScreeningId })
    notes?: Note[];
  }

  @Entity()
  class Film {
    @Field({ type: Number, isId: true })
    id?: number;
    @ManyToMany({ entity: () => Screening, through: () => FilmScreening })
    screenings?: Screening[];
  }

  expect(getMeta(Film).relations.screenings?.references).toEqual([
    { local: 'filmId', foreign: 'id' },
    { local: 'screeningId', foreign: 'id' },
  ]);
  const junction = getMeta(FilmScreening);
  expect(junction.relations.film?.cascade).toBe('delete');
  expect(junction.relations.notes?.references).toEqual([{ local: 'id', foreign: 'filmScreeningId' }]);
});

it('should refuse a mappedBy naming an inverse side, since neither side owns the foreign key', () => {
  @Entity()
  class Passport {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Traveller, mappedBy: (traveller) => traveller.passports })
    travellers?: Traveller[];
  }

  @Entity()
  class Traveller {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Passport, mappedBy: (passport) => passport.travellers })
    passports?: Passport[];
  }

  expect(() => getMeta(Traveller)).toThrow(
    `'Traveller.passports' is mapped by 'Passport.travellers', an inverse side too, so neither owns the foreign key.`,
  );
});

/** Types keep the two apart; this is the guard for a caller they cannot see, such as plain JavaScript. */
it('should refuse references on a relation through a junction, whose own columns say how it joins', () => {
  class Shelf {}
  const options = { cardinality: 'mm', entity: () => Shelf, through: () => Shelf, references: () => [] };
  // @ts-expect-error: plain JavaScript
  expect(() => defineRelation(Shelf, 'shelves', options)).toThrow(
    "'Shelf.shelves' joins through a junction, whose column referencing each side is the join; 'references' pairs the declaring entity's columns with the target's instead.",
  );
});

it('should say so for a relation with no columns to join on', () => {
  class Terminal {
    id?: number;
  }
  defineEntity(Terminal, { fields: { id: { type: Number, isId: true } } });

  class Gate {
    id?: number;
    terminal?: Terminal;
  }
  defineEntity(Gate, { fields: { id: { type: Number, isId: true } } });
  // Hand-written and empty: nothing filled it in, so nothing says how the two are joined.
  defineRelation(Gate, 'terminal', { cardinality: 'm1', entity: () => Terminal, references: (gate, terminal) => [] });

  expect(() => getMeta(Gate)).toThrow("'Gate.terminal' has no columns to join on.");
});

/** Stable projection for parity assertions (drops `entity` and the revision counters). */
function metaCore<E>(
  entity: Type<E>,
): Pick<EntityMeta<E>, 'ids' | 'name' | 'fields' | 'relations' | 'indexes' | 'hooks' | 'softDelete' | 'filters'> {
  const m = getMeta(entity);
  return {
    ids: m.ids,
    name: m.name,
    fields: m.fields,
    relations: m.relations,
    indexes: m.indexes,
    hooks: m.hooks,
    softDelete: m.softDelete,
    filters: m.filters,
  };
}

it('should register bulk fields as incremental defineField and defineEntity do', () => {
  class Incremental {
    id?: number;
    title?: string;
  }
  defineField(Incremental, 'id', { type: Number, isId: true });
  defineField(Incremental, 'title', { type: String, nullable: false });
  defineEntity(Incremental, { name: 'ArticleIncr' });

  class Bulk {
    id?: number;
    title?: string;
  }
  defineEntity(Bulk, {
    name: 'ArticleBulk',
    fields: {
      id: { type: Number, isId: true },
      title: { type: String, nullable: false },
    },
  });

  expect(metaCore(Incremental).fields).toEqual(metaCore(Bulk).fields);
  expect(metaCore(Incremental).ids).toEqual(metaCore(Bulk).ids);
});

it('should register bulk relations and their foreign keys as incremental registration does', () => {
  class Target {
    id?: number;
  }
  defineEntity(Target, {
    fields: { id: { type: Number, isId: true } },
  });

  class Incremental {
    id?: number;
    targetId?: number;
    target?: Target;
  }
  defineField(Incremental, 'id', { type: Number, isId: true });
  defineField(Incremental, 'targetId', { type: Number, references: () => Target });
  defineRelation(Incremental, 'target', {
    cardinality: 'm1',
    entity: () => Target,
    references: (incremental) => incremental.targetId,
  });
  defineEntity(Incremental, { name: 'LinkedRow' });

  class Bulk {
    id?: number;
    targetId?: number;
    target?: Target;
  }
  defineEntity(Bulk, {
    name: 'LinkedRow',
    fields: {
      id: { type: Number, isId: true },
      targetId: { type: Number, references: () => Target, nullable: false },
    },
    relations: {
      target: { cardinality: 'm1', entity: () => Target, references: (bulk) => bulk.targetId },
    },
  });

  const a = metaCore(Incremental);
  const b = metaCore(Bulk);

  const [aId, bId] = [a.fields['id'], b.fields['id']];
  assertDefined(aId);
  assertDefined(bId);
  expect(aId.type).toBe(bId.type);
  expect(aId.isId).toBe(bId.isId);
  expect(aId.references).toBeUndefined();
  expect(bId.references).toBeUndefined();

  expect(a.fields['targetId']?.type).toBe(b.fields['targetId']?.type);
  expect(a.fields['targetId']?.isId).toBe(b.fields['targetId']?.isId);
  expect(a.fields['targetId']?.references?.()).toBe(Target);
  expect(b.fields['targetId']?.references?.()).toBe(Target);

  expect(a.relations['target']?.cardinality).toBe(b.relations['target']?.cardinality);
  expect(a.relations['target']?.references).toEqual(b.relations['target']?.references);
  expect(a.relations['target']?.entity?.()).toBe(Target);
  expect(b.relations['target']?.entity?.()).toBe(Target);
});

it('should let bulk relations point at an entity shaped differently from the owner', () => {
  // Each relation's `entity` returns its own target, so one whose fields differ from the owner's
  // (`id: string` against `id: number`) type-checks.
  class Author {
    id?: string;
  }
  defineEntity(Author, { fields: { id: { type: String, isId: true } } });

  class Book {
    id?: number;
    authorId?: string | null;
    author?: Author;
  }
  defineEntity(Book, {
    fields: {
      id: { type: Number, isId: true },
      authorId: { references: () => Author },
    },
    relations: {
      author: { cardinality: 'm1', entity: () => Author, references: (book) => book.authorId },
    },
  });

  expect(getMeta(Book).relations['author']?.entity?.()).toBe(Author);
});

it('should register bulk indexes and hooks', () => {
  class Indexed {
    id?: number;
    email?: string | null;
    status?: string | null;

    stampCreatedAt() {}
    hydrate() {}
  }
  defineEntity(Indexed, {
    fields: {
      id: { type: Number, isId: true },
      email: { type: String },
      status: { type: String },
    },
    indexes: [
      { columns: (indexed) => [indexed.email, indexed.status], name: 'email_status_idx', unique: false },
      { columns: (indexed) => [indexed.email], include: (indexed) => [indexed.status], unique: true },
    ],
    hooks: {
      beforeInsert: (indexed) => [indexed.stampCreatedAt],
      afterLoad: (indexed) => [indexed.hydrate],
    },
  });

  const m = getMeta(Indexed);
  expect(m.indexes).toHaveLength(2);
  expect(m.indexes?.[0]).toMatchObject({
    columns: [{ column: 'email' }, { column: 'status' }],
    name: 'email_status_idx',
    unique: false,
  });
  expect(m.indexes?.[1]).toMatchObject({ columns: [{ column: 'email' }], include: ['status'], unique: true });
  expect(m.hooks?.beforeInsert).toEqual([{ methodName: 'stampCreatedAt' }]);
  expect(m.hooks?.afterLoad).toEqual([{ methodName: 'hydrate' }]);
});

it("should inherit a parent's fields when the parent was finalized first", () => {
  class ParentEntity {
    id?: number;
    baseCol?: string | null;
  }
  defineEntity(ParentEntity, {
    fields: {
      id: { type: Number, isId: true },
      baseCol: { type: String },
    },
  });

  class ChildEntity extends ParentEntity {
    childCol?: boolean | null;
  }
  defineEntity(ChildEntity, {
    fields: {
      childCol: { type: Boolean },
    },
  });

  const m = getMeta(ChildEntity);
  expect(m.fields['id']?.isId).toBe(true);
  expect(m.fields['baseCol']?.type).toBe(String);
  expect(m.fields['childCol']?.type).toBe(Boolean);
  expect(m.ids).toEqual(['id']);
});

it('should refuse bulk fields that declare no id', () => {
  class MissingId {
    title?: string | null;
  }
  expect(() =>
    defineEntity(MissingId, {
      fields: { title: { type: String } },
    }),
  ).toThrow(/at least one id field/);
});

it('should register a bulk isId as defineId does', () => {
  class A {
    pk?: string;
    x?: number | null;
  }
  defineEntity(A, {
    fields: { pk: { type: String, isId: true }, x: { type: Number } },
  });
  class B {
    pk?: string;
    x?: number;
  }
  defineId(B, 'pk', { type: String });
  defineField(B, 'x', { type: Number });
  defineEntity(B, {});

  expect(getMeta(A).ids[0]).toBe('pk');
  expect(getMeta(B).ids[0]).toBe('pk');
  expect(getMeta(A).fields).toEqual(getMeta(B).fields);
});

it('should register bulk filters as incremental defineFilter does', () => {
  class Incremental {
    id?: number;
    status?: string;
  }
  defineId(Incremental, 'id', { type: Number });
  defineField(Incremental, 'status', { type: String });
  defineFilter(Incremental, 'active', { where: { status: 'active' }, default: false });
  defineEntity(Incremental, { name: 'TaskIncr' });

  class Bulk {
    id?: number;
    status?: string | null;
  }
  defineEntity(Bulk, {
    name: 'TaskBulk',
    fields: {
      id: { type: Number, isId: true },
      status: { type: String },
    },
    filters: {
      active: { where: { status: 'active' }, default: false },
    },
  });

  expect(metaCore(Incremental).filters).toEqual(metaCore(Bulk).filters);
});

it('should keep the name and schema a first defineEntity set', () => {
  class Composed {
    id?: number;
    title?: string | null;
    extra?: string | null;
  }
  defineEntity(Composed, {
    name: 'composed_rows',
    schema: 'cms',
    fields: { id: { type: Number, isId: true }, title: { type: String } },
  });

  // A later registration adds to the entity; it says nothing about the table, so it retracts nothing.
  defineEntity(Composed, { fields: { extra: { type: String } } });

  const meta = getMeta(Composed);
  expect(meta.name).toBe('composed_rows');
  expect(meta.schema).toBe('cms');
  expect(Object.keys(meta.fields)).toEqual(['id', 'title', 'extra']);
});
