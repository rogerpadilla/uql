import { EntityMeta, ReferenceOptions } from '@uql/core/type';
import {
  User,
  Item,
  TaxCategory,
  Profile,
  Company,
  MeasureUnit,
  Tax,
  LedgerAccount,
  InventoryAdjustment,
  ItemAdjustment,
  MeasureUnitCategory,
  Storehouse,
  Tag,
  ItemTag,
} from '../../test';
import { getEntities, getMeta } from './definition';
import { Entity } from './entity';
import { Id } from './id';
import { Property } from './property';

it('User', () => {
  const meta = getMeta(User);

  expect((meta.properties['companyId'].reference as ReferenceOptions).entity()).toBe(Company);
  expect(meta.relations['company'].entity()).toBe(Company);
  expect(meta.relations['company'].references).toEqual([{ source: 'companyId', target: 'id' }]);

  expect((meta.properties['userId'].reference as ReferenceOptions).entity()).toBe(User);
  expect(meta.relations['user'].entity()).toBe(User);
  expect(meta.relations['user'].references).toEqual([{ source: 'userId', target: 'id' }]);

  const expectedMeta: EntityMeta<User> = {
    entity: User,
    name: 'User',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      name: { name: 'name', type: String },
      email: { name: 'email', type: String },
      password: { name: 'password', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
      users: {
        cardinality: '1m',
        entity: expect.any(Function),
        mappedBy: 'user',
        references: [{ source: 'id', target: 'userId' }],
      },
      profile: {
        cardinality: '11',
        entity: expect.any(Function),
        mappedBy: 'user',
        references: [{ source: 'id', target: 'userId' }],
      },
    },
  };

  expect(meta).toEqual(expectedMeta);
});

it('Profile', () => {
  const meta = getMeta(Profile);
  const expectedMeta: EntityMeta<Profile> = {
    entity: Profile,
    name: 'user_profile',
    id: { name: 'pk', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'pk', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      picture: { name: 'image', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: '11',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('Item', () => {
  const meta = getMeta(Item);
  const expectedMeta: EntityMeta<Item> = {
    entity: Item,
    name: 'Item',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
      code: { name: 'code', type: String },
      barcode: { name: 'barcode', type: String },
      image: { name: 'image', type: String },
      buyLedgerAccountId: {
        name: 'buyLedgerAccountId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      saleLedgerAccountId: {
        name: 'saleLedgerAccountId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      taxId: {
        name: 'taxId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      measureUnitId: {
        name: 'measureUnitId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      buyPriceAverage: { name: 'buyPriceAverage', type: Number },
      salePrice: { name: 'salePrice', type: Number },
      inventoryable: { name: 'inventoryable', type: Boolean },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'buyLedgerAccountId', target: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'saleLedgerAccountId', target: 'id' }],
      },
      tax: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'taxId', target: 'id' }],
      },
      measureUnit: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'measureUnitId', target: 'id' }],
      },
      tags: {
        cardinality: 'mm',
        entity: expect.any(Function),
        through: expect.any(Function),
        references: [
          { source: 'itemId', target: 'id' },
          { source: 'tagId', target: 'id' },
        ],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('Tag', () => {
  const meta = getMeta(Tag);
  const expectedMeta: EntityMeta<Tag> = {
    entity: Tag,
    id: {
      isId: true,
      name: 'id',
      property: 'id',
      type: String,
    },
    name: 'Tag',
    processed: true,
    properties: {
      companyId: {
        name: 'companyId',
        reference: {
          entity: expect.any(Function),
        },
        type: String,
      },
      createdAt: {
        name: 'createdAt',
        onInsert: expect.any(Function),
        type: Number,
      },
      id: {
        isId: true,
        name: 'id',
        type: String,
      },
      name: {
        name: 'name',
        type: String,
      },
      status: {
        name: 'status',
        type: Number,
      },
      updatedAt: {
        name: 'updatedAt',
        onUpdate: expect.any(Function),
        type: Number,
      },
      userId: {
        name: 'userId',
        reference: {
          entity: expect.any(Function),
        },
        type: String,
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      items: {
        cardinality: 'mm',
        entity: expect.any(Function),
        mappedBy: 'tags',
        through: expect.any(Function),
        references: [
          { source: 'itemId', target: 'id' },
          { source: 'tagId', target: 'id' },
        ],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('TaxCategory', () => {
  const meta = getMeta(TaxCategory);
  const expectedMeta: EntityMeta<TaxCategory> = {
    entity: TaxCategory,
    name: 'TaxCategory',
    id: { name: 'pk', type: String, isId: true, onInsert: expect.any(Function), property: 'pk' },
    processed: true,
    properties: {
      pk: { name: 'pk', type: String, isId: true, onInsert: expect.any(Function) },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('Tax', () => {
  const meta = getMeta(Tax);
  const expectedMeta: EntityMeta<Tax> = {
    entity: Tax,
    name: 'Tax',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      categoryId: {
        name: 'categoryId',
        reference: {
          entity: expect.any(Function),
        },
        type: String,
      },
      percentage: {
        name: 'percentage',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      category: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [
          {
            source: 'categoryId',
            target: 'pk',
          },
        ],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('ItemAdjustment', () => {
  const meta = getMeta(ItemAdjustment);
  const expectedMeta: EntityMeta<ItemAdjustment> = {
    entity: ItemAdjustment,
    name: 'ItemAdjustment',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      buyPrice: {
        name: 'buyPrice',
        type: Number,
      },
      inventoryAdjustmentId: {
        name: 'inventoryAdjustmentId',
        reference: {
          entity: expect.any(Function),
        },
        type: String,
      },
      itemId: {
        name: 'itemId',
        reference: {
          entity: expect.any(Function),
        },
        type: String,
      },
      number: {
        name: 'number',
        type: Number,
      },
      storehouseId: {
        name: 'storehouseId',
        reference: {
          entity: expect.any(Function),
        },
        type: String,
      },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
    },
    relations: {
      storehouse: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'storehouseId', target: 'id' }],
      },
      item: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'itemId', target: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('InventoryAdjustment', () => {
  const meta = getMeta(InventoryAdjustment);
  const expectedMeta: EntityMeta<InventoryAdjustment> = {
    entity: InventoryAdjustment,
    name: 'InventoryAdjustment',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { entity: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      description: { name: 'description', type: String },
      date: { name: 'date', type: Number },
    },
    relations: {
      itemAdjustments: {
        cardinality: '1m',
        entity: expect.any(Function),
        mappedBy: 'inventoryAdjustmentId',
        references: [{ source: 'inventoryAdjustmentId', target: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    id: string;
  }

  expect(() => getMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});

it('getEntities', () => {
  const entities = getEntities();
  expect(entities).toEqual([
    Company,
    Profile,
    User,
    LedgerAccount,
    TaxCategory,
    Tax,
    MeasureUnitCategory,
    MeasureUnit,
    Storehouse,
    Tag,
    Item,
    ItemTag,
    ItemAdjustment,
    InventoryAdjustment,
  ]);
});

it('no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Property()
      id: string;
    }
  }).toThrow(`'SomeEntity' must have one field decorated with @Id`);
});

it('one @Id', () => {
  expect(() => {
    class SomeEntity {
      @Id()
      idOne: string;
      @Id()
      idTwo: string;
    }
  }).toThrow(`'SomeEntity' must have a single field decorated with @Id`);
});

it('no properties', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id: string;
    }
  }).toThrow(`'SomeEntity' must have properties`);
});
