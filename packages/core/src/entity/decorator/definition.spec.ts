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
} from '../../test';
import { Id } from './id';
import { getEntities, getMeta } from './definition';

it('user', () => {
  const meta = getMeta(User);

  expect(meta.properties['companyId'].reference.type()).toBe(Company);
  expect(meta.relations['company'].type()).toBe(Company);
  expect(meta.relations['company'].references).toEqual([{ source: 'companyId', target: 'id' }]);

  expect(meta.properties['userId'].reference.type()).toBe(User);
  expect(meta.relations['user'].type()).toBe(User);
  expect(meta.relations['user'].references).toEqual([{ source: 'userId', target: 'id' }]);

  expect(meta).toEqual({
    type: User,
    name: 'User',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { type: expect.any(Function) },
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
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
      users: {
        cardinality: 'oneToMany',
        type: expect.any(Function),
        mappedBy: 'userId',
        references: [{ source: 'id', target: 'userId' }],
      },
      profile: {
        cardinality: 'oneToOne',
        type: expect.any(Function),
        mappedBy: 'userId',
        references: [
          {
            source: 'id',
            target: 'userId',
          },
        ],
      },
    },
  });
});

it('profile', () => {
  const meta = getMeta(Profile);
  expect(meta).toEqual({
    type: Profile,
    name: 'user_profile',
    id: { name: 'pk', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'pk', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      picture: { name: 'image', type: String },
    },
    relations: {
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  });
});

it('item', () => {
  const meta = getMeta(Item);
  expect(meta).toEqual({
    type: Item,
    name: 'Item',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { type: expect.any(Function) },
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
        reference: { type: expect.any(Function) },
      },
      saleLedgerAccountId: {
        name: 'saleLedgerAccountId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      taxId: {
        name: 'taxId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      measureUnitId: {
        name: 'measureUnitId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      buyPriceAverage: { name: 'buyPriceAverage', type: Number },
      salePrice: { name: 'salePrice', type: Number },
      inventoryable: { name: 'inventoryable', type: Boolean },
    },
    relations: {
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'buyLedgerAccountId', target: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'saleLedgerAccountId', target: 'id' }],
      },
      tax: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'taxId', target: 'id' }],
      },
      measureUnit: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'measureUnitId', target: 'id' }],
      },
      tags: {
        cardinality: 'manyToMany',
        type: expect.any(Function),
        through: 'ItemTag',
        references: [
          { source: 'itemId', target: 'id' },
          { source: 'tagId', target: 'id' },
        ],
      },
    },
  });
});

it('taxCategory', () => {
  const meta = getMeta(TaxCategory);
  expect(meta).toEqual({
    type: TaxCategory,
    name: 'TaxCategory',
    id: { name: 'pk', type: String, isId: true, onInsert: expect.any(Function), property: 'pk' },
    processed: true,
    properties: {
      pk: { name: 'pk', type: String, isId: true, onInsert: expect.any(Function) },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  });
});

it('InventoryAdjustment', () => {
  const meta = getMeta(InventoryAdjustment);
  expect(meta).toEqual({
    type: InventoryAdjustment,
    name: 'InventoryAdjustment',
    id: { name: 'id', type: String, isId: true, property: 'id' },
    processed: true,
    properties: {
      id: { name: 'id', type: String, isId: true },
      companyId: {
        name: 'companyId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      userId: {
        name: 'userId',
        type: String,
        reference: { type: expect.any(Function) },
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      description: { name: 'description', type: String },
      date: { name: 'date', type: Number },
    },
    relations: {
      itemAdjustments: {
        cardinality: 'oneToMany',
        type: expect.any(Function),
        mappedBy: 'inventoryAdjustmentId',
        references: [{ source: 'id', target: 'inventoryAdjustmentId' }],
      },
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  });
});

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    @Id()
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
    ItemAdjustment,
    InventoryAdjustment,
  ]);
});
