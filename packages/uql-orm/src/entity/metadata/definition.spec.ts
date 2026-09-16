import { expect, it } from 'vitest';
import {
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
import { type EntityMeta, type IdKey, QueryRaw, RAW_VALUE, idKey } from '../../type/index.js';
import { getKeys, raw } from '../../util/index.js';
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

it('defineEntity passes over a member given as undefined', () => {
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

it('assertSoleId names an entity that declares no primary key', () => {
  class Keyless {}
  const meta = defineField(Keyless, 'name', { type: String });
  expect(() => assertSoleId(meta, 'a key lookup')).toThrow("'Keyless' has no primary key, which a key lookup needs.");
});

it('assertSoleId names the columns of a composite key, and idOf names its row by every one', () => {
  @Entity()
  class Seat {
    [idKey]?: 'row' | 'number';
    @Id({ type: String }) row?: string;
    @Id({ type: Number }) number?: number;
    @Field({ type: String }) holder?: string;
  }
  const meta = getMeta(Seat);
  expect(() => assertSoleId(meta, 'a key lookup')).toThrow(
    "'Seat' has a composite primary key (row, number), which a key lookup does not support yet.",
  );
  expect(idOf(meta, { row: 'F', number: 12, holder: 'Ada' })).toEqual({ row: 'F', number: 12 });
});

it('fieldOf names the field it reads, and refuses one the entity does not declare', () => {
  const meta = getMeta(User);
  expect(fieldOf(meta, 'name')).toBe(meta.fields.name);
  // Outside the types, which name a field; the throw is for a key that reached it untyped.
  expect(() => fieldOf(meta, 'nope' as never)).toThrow("'User' has no field 'nope'");
});

it('relationOf names the relation it reads, and refuses one the entity does not declare', () => {
  const meta = getMeta(User);
  expect(relationOf(meta, 'company')).toBe(meta.relations.company);
  // Outside the types, which name a relation; the throw is for a key that reached it untyped.
  expect(() => relationOf(meta, 'name' as never)).toThrow("'User' has no relation 'name'");
});

it('defineEntity keeps a check constraint as authored, for the schema build to render', () => {
  class Stocked {
    id?: number;
    quantity?: number;
  }
  const checks = [{ name: 'quantity_positive', where: raw`quantity > 0` }, { where: raw`quantity < 1000` }];
  const meta = defineEntity(Stocked, {
    fields: { id: { type: Number, isId: true }, quantity: { type: Number } },
    checks,
  });
  expect(meta.checks).toEqual(checks);
});

it('defineField refuses an option the column type does not take', () => {
  class Conflicted {}
  expect(() => defineField(Conflicted, 'amount', { type: Number, length: 10 })).toThrow(
    "'Conflicted.amount' cannot use 'length': it applies to a string column, not to a numeric one.",
  );
});

it('defineEntity refuses a dotted name, pointing at the schema option', () => {
  class Dotted {}
  expect(() => defineEntity(Dotted, { name: 'crm.users', fields: { id: { type: Number, isId: true } } })).toThrow(
    "'Dotted' has a dotted name 'crm.users'. Name the schema separately as { schema: 'crm', name: 'users' }.",
  );
});

it('an inverse side keeps the columns it names itself', () => {
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
    @Field({ references: () => Shelf }) shelfRef?: number;
    @ManyToOne({ entity: () => Shelf, references: (book, shelf) => [{ local: book.shelfRef, foreign: shelf.id }] })
    shelf?: Shelf;
  }
  expect(getMeta(Shelf).relations.books?.references).toEqual([{ local: 'id', foreign: 'shelfRef' }]);
});

it('a foreign key column is a column, with no relation it did not declare', () => {
  @Entity()
  class Warehouse {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Pallet {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Warehouse }) warehouseId?: number;
  }
  const meta = getMeta(Pallet);
  expect(meta.relations).toEqual({});
  expect(meta.fields.warehouseId!.references!()).toBe(Warehouse);
});

it('a junction column is the one referencing its side, whatever either is called', () => {
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
    @Field({ references: () => Course }) course?: number;
    @Field({ references: () => Student }) learner?: number;
  }
  expect(getMeta(Course).relations.students?.references).toEqual([
    { local: 'course', foreign: 'id' },
    { local: 'learner', foreign: 'id' },
  ]);
});

it('User', () => {
  const meta = getMeta(User);

  expect(meta.fields.companyId!.references!()).toBe(Company);
  expect(meta.relations.company!.entity!()).toBe(Company);
  expect(meta.relations.company!.references).toEqual([{ local: 'companyId', foreign: 'id' }]);

  expect(meta.fields.creatorId!.references!()).toBe(User);
  expect(meta.relations.creator!.entity!()).toBe(User);
  expect(meta.relations.creator!.references).toEqual([{ local: 'creatorId', foreign: 'id' }]);

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

it('Profile', () => {
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

it('Item', () => {
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
        type: Number,
        computed: expect.any(QueryRaw),
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

it('Tag', () => {
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
        type: Number,
        computed: expect.objectContaining({
          [RAW_VALUE]: expect.any(Function),
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

it('ItemTag', () => {
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

it('TaxCategory', () => {
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

it('Tax', () => {
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

it('ItemAdjustment', () => {
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

it('InventoryAdjustment', () => {
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

it('MeasureUnitCategory', () => {
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

it('MeasureUnit', () => {
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

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    id!: string;
  }

  expect(() => getMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});

it('getEntities', () => {
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

it('no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field({ type: String })
      id!: string;
    }
  }).toThrow(
    `'SomeEntity' must have at least one id field (use @Id, defineId, or defineEntity({ fields: { ..., isId: true } }))`,
  );
});

it('no fields', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id!: string;
    }
  }).toThrow(`'SomeEntity' must have fields`);
});

it('one-to-many through a junction joins by the junction columns', () => {
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
    authorId?: number;
    @Field({ type: Number, references: () => Book })
    bookId?: number;
  }

  @Entity()
  class Book {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Author, through: () => BookAuthor })
    authors?: Author[];
  }

  const meta = getMeta(Book);

  expect(meta.relations.authors!.references).toEqual([
    { local: 'bookId', foreign: 'id' },
    { local: 'authorId', foreign: 'id' },
  ]);
});

it('to-many relation with no way to join', () => {
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

it('mappedBy naming neither a field nor a relation', () => {
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

it('a junction with no column referencing a side says which to declare', () => {
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
    colourId?: number;
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

it('refuses a junction where two columns reference the same key', () => {
  @Entity()
  class Person {
    @Id({ type: Number }) id?: number;
    @ManyToMany({ entity: () => Person, through: () => Friendship }) friends?: Person[];
  }
  @Entity()
  class Friendship {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Person }) personId?: number;
    @Field({ references: () => Person }) friendId?: number;
  }

  expect(() => getMeta(Person)).toThrow(
    `'Person.friends' joins through 'Friendship', where 'personId' and 'friendId' each reference 'Person.id': a junction needs exactly one column per key of each side.`,
  );
});

it('a junction resolves when read first, even with an inverse side leading back through it', () => {
  @Entity()
  class Film {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Screening {
    @Id({ type: Number }) id?: number;
    // Ahead of the junction's own foreign key, and leading back through the junction.
    @OneToMany({ entity: () => Review, mappedBy: (review) => review.screening }) reviews?: Review[];
    @Field({ references: () => Film }) filmId?: number;
    @ManyToOne({ entity: () => Film, references: (screening) => screening.filmId }) film?: Film;
    @Field({ references: () => Review }) reviewId?: number;
  }
  @Entity()
  class Review {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Screening }) screeningId?: number;
    @ManyToOne({ entity: () => Screening, references: (review) => review.screeningId }) screening?: Screening;
    @ManyToMany({ entity: () => Film, through: () => Screening }) films?: Film[];
  }

  expect(getMeta(Screening).relations.reviews?.references).toEqual([{ local: 'id', foreign: 'screeningId' }]);
  expect(getMeta(Review).relations.films?.references).toEqual([
    { local: 'reviewId', foreign: 'id' },
    { local: 'filmId', foreign: 'id' },
  ]);
});

it('an inverse side of a relation through a junction resolves whichever side is read first', () => {
  @Entity()
  class Genre {
    @Id({ type: Number }) id?: number;
    @ManyToMany({ entity: () => Album, mappedBy: (album) => album.genres }) albums?: Album[];
    @Field({ references: () => Album }) featuredId?: number;
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
    @Field({ references: () => Album }) albumId?: number;
    @Field({ references: () => Genre }) genreId?: number;
  }

  expect(getMeta(Album).relations.featuredBy?.references).toEqual([{ local: 'id', foreign: 'featuredId' }]);
  expect(getMeta(Genre).relations.albums?.references).toEqual([
    { local: 'genreId', foreign: 'id' },
    { local: 'albumId', foreign: 'id' },
  ]);
});

it('at most one softDelete field', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field({ type: String, isId: true })
      id!: string;
      @Field({ type: Number, softDelete: true })
      deletedAt?: number;
      @Field({ type: Date, softDelete: () => new Date() })
      archivedAt?: Date;
    }
  }).toThrow(`'SomeEntity' must have at most one field with 'softDelete'`);
});

it('a to-one joins on the foreign key its references names, whatever either is called', () => {
  @Entity()
  class Author {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Essay, mappedBy: (essay) => essay.author }) essays?: Essay[];
  }
  @Entity()
  class Essay {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Author }) writtenById?: number;
    @ManyToOne({ entity: () => Author, references: (essay) => essay.writtenById }) author?: Author;
  }

  expect(getMeta(Author).relations.essays?.references).toEqual([{ local: 'id', foreign: 'writtenById' }]);
  expect(getMeta(Essay).relations.author?.references).toEqual([{ local: 'writtenById', foreign: 'id' }]);
  expect(getKeys(getMeta(Essay).fields)).toEqual(['id', 'writtenById']);
});

it('refuses a to-one naming no foreign key, on every read rather than handing back a half-resolved one', () => {
  @Entity()
  class Quay {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Barge {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Quay }) quayId?: number;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @ManyToOne({ entity: () => Quay }) quay?: Quay;
  }

  const refusal =
    "'Barge.quay' needs 'references', the foreign key column it joins by, or 'mappedBy', the member on the " +
    'other side holding it.';
  expect(() => getMeta(Barge)).toThrow(refusal);
  expect(() => getMeta(Barge)).toThrow(refusal);
});

it('refuses a join on a member that is not a column of its entity', () => {
  @Entity()
  class Pier {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number, computed: raw`1` }) berthCount?: number;
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
    pierId?: number;
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

it('refuses a to-one whose foreign key references another entity', () => {
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
    @Field({ references: () => Marina }) harbourId?: number;
    @ManyToOne({ entity: () => Harbour, references: (ferry) => ferry.harbourId }) harbour?: Harbour;
  }

  expect(() => getMeta(Ferry)).toThrow(
    "'Ferry.harbour' joins 'Ferry.harbourId', a foreign key to 'Marina', not to 'Harbour'.",
  );
});

it('refuses references naming one column for a composite key, which needs a column per key', () => {
  @Entity()
  class Locker {
    [idKey]?: 'row' | 'slot';
    @Id({ type: String }) row?: string;
    @Id({ type: Number }) slot?: number;
  }
  @Entity()
  class Rental {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) lockerRef?: string;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @ManyToOne({ entity: () => Locker, references: (rental) => rental.lockerRef }) locker?: Locker;
  }

  expect(() => getMeta(Rental)).toThrow(
    "'Rental.locker' names one column, 'lockerRef', which only a to-one holding a foreign key to a one-column key " +
      'can: pair the columns, [{ local, foreign }].',
  );
});

/** Types keep one column to the side of a to-one holding the key; this is the guard for a caller they cannot see. */
it('refuses references naming one column on a relation that holds no foreign key', () => {
  class Dock {
    id?: number;
  }
  defineEntity(Dock, { fields: { id: { type: Number, isId: true } } });
  class Ship {
    id?: number;
    dockId?: number;
  }
  defineEntity(Ship, { fields: { id: { type: Number, isId: true }, dockId: { type: Number } } });
  const options = { cardinality: '1m', entity: () => Dock, references: () => 'dockId' } as never;
  defineRelation(Ship, 'docks', options);

  expect(() => getMeta(Ship)).toThrow(
    "'Ship.docks' names one column, 'dockId', which only a to-one holding a foreign key to a one-column key " +
      'can: pair the columns, [{ local, foreign }].',
  );
});

it('a relation a base class declares joins on its foreign key in every entity extending it', () => {
  @Entity()
  class Region {
    @Id({ type: Number }) id?: number;
  }
  abstract class Regional {
    @Field({ references: () => Region }) regionId?: number;
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

it('auto-registers the built-in softDelete filter from @Field({ softDelete })', () => {
  const meta = getMeta(MeasureUnit);
  expect(meta.filters?.['softDelete']).toEqual({ where: { deletedAt: null }, default: true });
});

it('registers @Filter and bulk filters', () => {
  @Filter('active', { where: { status: 'active' }, default: false })
  @Entity({ filters: { recent: { where: { status: 'new' } } } })
  class FilteredEntity {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    status?: string;
  }
  const meta = getMeta(FilteredEntity);
  expect(meta.filters?.['active']).toEqual({ where: { status: 'active' }, default: false });
  expect(meta.filters?.['recent']).toEqual({ where: { status: 'new' } });
});

it('softDelete is a reserved filter name', () => {
  expect(() => {
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @Filter('softDelete', { where: { status: 'bogus' } })
    @Entity()
    class ReservedFilter {
      @Id({ type: Number })
      id?: number;
      @Field({ type: String })
      status?: string;
    }
    return ReservedFilter;
  }).toThrow("filter name 'softDelete' is reserved");
});

/**
 * A `security` filter is row-level security: `skip` would silently drop it whenever its condition
 * can't resolve (no context, missing tenant id), returning every row instead of none. It has to
 * fail closed, so the combination is rejected at registration rather than at query time.
 */
it('a security filter cannot opt into skipping when its condition is unresolved', () => {
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
it('a second @Id makes the primary key composite', () => {
  @Entity()
  class Membership {
    [idKey]?: 'userId' | 'groupId';
    @Id({ type: Number })
    userId?: number;
    @Id({ type: Number })
    groupId?: number;
    @Field({ type: String })
    role?: string;
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
it('a junction pairs every key of both sides, and the inverse side swaps the groups', () => {
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
    @Field({ type: Number }) enrolmentStudentId?: number;
    @Field({ type: String }) enrolmentCourseId?: string;
    @ManyToOne({
      entity: () => Enrolment,
      references: (enrolmentBadge, enrolment) => [
        { local: enrolmentBadge.enrolmentStudentId, foreign: enrolment.studentId },
        { local: enrolmentBadge.enrolmentCourseId, foreign: enrolment.courseId },
      ],
    })
    enrolment?: Enrolment;
    @Field({ references: () => Badge }) badgeId?: number;
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
it('refuses an inverse relation mapped by a field when the key is composite', () => {
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) enrolmentStudentId?: number;
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
it('pairs an inverse relation mapped by a field from the parent side', () => {
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) ownerId?: number;
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
it('refuses an inverse relation mapped by a field referencing another entity', () => {
  @Entity()
  class Reader {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Review {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Reader }) readerId?: number;
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

it('refuses a to-many joining columns whose foreign key, on the other side, references another entity', () => {
  @Entity()
  class Crew {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Sailor {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Crew }) crewId?: number;
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

it('refuses an inverse relation mapped by a relation to another entity', () => {
  @Entity()
  class Editor {
    @Id({ type: Number }) id?: number;
  }
  @Entity()
  class Draft {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) editorId?: number;
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

it('accepts an inverse relation mapped by a field referencing the entity it inherits it from', () => {
  @Entity()
  class Shelf {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Volume, mappedBy: (volume) => volume.shelfId })
    volumes?: Volume[];
  }
  class Bookcase extends Shelf {
    label?: string;
  }
  defineEntity(Bookcase, { fields: { label: { type: String } } });
  @Entity()
  class Volume {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Shelf }) shelfId?: number;
  }

  expect(getMeta(Bookcase).relations.volumes?.references).toEqual([{ local: 'id', foreign: 'shelfId' }]);
});

/** The message a registration error carries, for a test that pins what it says and not how. */
function getError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a registration error');
}

/** One column cannot reference a two-column key; the relation decorators make one column per key. */
it('refuses a plain foreign key pointing at a composite key', () => {
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
    @Field({ references: () => Enrolment }) enrolmentStudentId?: number;
  }

  // The column, the key it cannot reach, and the decorator that can: the rest is wording.
  const error = getError(() => getMeta(Note));
  expect(error).toContain(`'Note.enrolmentStudentId'`);
  expect(error).toContain('composite (studentId, courseId)');
  expect(error).toContain("pair each with it in a '@ManyToOne' to 'Enrolment'");
});

/** Every column of the parent's key, or the ones it did not replace would widen the child's. */
it('a subclass declaring its own key drops every key of a composite parent', () => {
  @Entity()
  class Pair {
    [idKey]?: 'left' | 'right';
    @Id({ type: Number }) left?: number;
    @Id({ type: Number }) right?: number;
    @Field({ type: String }) label?: string;
  }
  @Entity()
  class Single extends Pair {
    @Id({ type: Number }) id?: number;
  }

  const meta = getMeta(Single);
  expect(meta.ids).toEqual(['id']);
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'label']);
});

it('subclass declaring the only @Id inherits the parent fields', () => {
  class IdlessBase {
    @Field({ type: String })
    name?: string;
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

it('subclass inherits parent softDelete field key and filters', () => {
  @Filter('active', { where: { status: 'active' }, default: false })
  @Entity()
  class SoftBase {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    status?: string;
    @Field({ type: Date, softDelete: true })
    deletedAt?: Date;
  }

  @Entity()
  class SoftChild extends SoftBase {
    @Field({ type: String })
    name?: string;
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
it('extends inherits the fields, relations, hooks and filters of a base and its own base', () => {
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
    title?: string;
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

it('a base named by extends keeps its own table, and the child what it declares itself', () => {
  class Auditable {
    id?: number;
    label?: string;
    archived?: boolean;
  }
  defineEntity(Auditable, {
    name: 'auditable',
    fields: { id: { type: Number, isId: true }, label: { type: String }, archived: { type: Boolean } },
  });

  class Invoice {
    [idKey]?: 'ref';
    ref?: string;
    label?: string;
    archived?: boolean;
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

it('a class that both extends and names a base takes the nearer one', () => {
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

it('a junction keeps the relations it declares itself', () => {
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
    filmScreeningId?: number;
  }

  @Entity()
  class FilmScreening {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ references: () => Film })
    filmId?: number;
    @ManyToOne({ entity: () => Film, cascade: 'delete', references: (filmScreening) => filmScreening.filmId })
    film?: Film;
    @Field({ references: () => Screening })
    screeningId?: number;
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

  expect(getMeta(Film).relations.screenings!.references).toEqual([
    { local: 'filmId', foreign: 'id' },
    { local: 'screeningId', foreign: 'id' },
  ]);
  const junction = getMeta(FilmScreening);
  expect(junction.relations.film!.cascade).toBe('delete');
  expect(junction.relations.notes!.references).toEqual([{ local: 'id', foreign: 'filmScreeningId' }]);
});

it('mappedBy naming an inverse side, so neither side owns the foreign key', () => {
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
it('refuses references on a relation through a junction, whose own columns say how it joins', () => {
  class Shelf {}
  const options = { cardinality: 'mm', entity: () => Shelf, through: () => Shelf, references: () => [] } as never;
  expect(() => defineRelation(Shelf, 'shelves', options)).toThrow(
    "'Shelf.shelves' joins through a junction, whose column referencing each side is the join; 'references' pairs the declaring entity's columns with the target's instead.",
  );
});

it('a relation with no columns to join on says so', () => {
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
