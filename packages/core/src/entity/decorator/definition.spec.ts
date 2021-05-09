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
import { getEntities, getMeta } from './definition';

it('user', () => {
  const meta = getMeta(User);

  expect(meta.properties['companyId'].reference.entity()).toBe(Company);
  expect(meta.relations['company'].entity()).toBe(Company);
  expect(meta.relations['company'].references).toEqual([{ source: 'companyId', target: 'id' }]);

  expect(meta.properties['userId'].reference.entity()).toBe(User);
  expect(meta.relations['user'].entity()).toBe(User);
  expect(meta.relations['user'].references).toEqual([{ source: 'userId', target: 'id' }]);

  expect(meta).toEqual({
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
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
      users: {
        cardinality: 'oneToMany',
        entity: expect.any(Function),
        mappedBy: 'userId',
        references: [{ source: 'id', target: 'userId' }],
      },
      profile: {
        cardinality: 'oneToOne',
        entity: expect.any(Function),
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
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  });
});

it('item', () => {
  const meta = getMeta(Item);
  expect(meta).toEqual({
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
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'buyLedgerAccountId', target: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'saleLedgerAccountId', target: 'id' }],
      },
      tax: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'taxId', target: 'id' }],
      },
      measureUnit: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'measureUnitId', target: 'id' }],
      },
      tags: {
        cardinality: 'manyToMany',
        entity: expect.any(Function),
        through: 'ItemTag',
        references: [
          { source: 'itemId', target: 'id' },
          { source: 'tagId', target: 'id' },
        ],
      },
    },
  });
});

it('tag', () => {
  const meta = getMeta(Tag);
  expect(meta).toEqual({
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
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [
          {
            source: 'companyId',
            target: 'id',
          },
        ],
      },
      items: {
        cardinality: 'manyToMany',
        entity: expect.any(Function),
        references: [
          {
            source: 'tagId',
            target: 'id',
          },
          {
            source: 'itemId',
            target: 'id',
          },
        ],
        through: 'TagItem',
      },
      user: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [
          {
            source: 'userId',
            target: 'id',
          },
        ],
      },
    },
  });
});

it('taxCategory', () => {
  const meta = getMeta(TaxCategory);
  expect(meta).toEqual({
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
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'userId', target: 'id' }],
      },
    },
  });
});

it('InventoryAdjustment', () => {
  const meta = getMeta(InventoryAdjustment);
  expect(meta).toEqual({
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
        cardinality: 'oneToMany',
        entity: expect.any(Function),
        mappedBy: 'inventoryAdjustmentId',
        references: [{ source: 'id', target: 'inventoryAdjustmentId' }],
      },
      company: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
        references: [{ source: 'companyId', target: 'id' }],
      },
      user: {
        cardinality: 'manyToOne',
        entity: expect.any(Function),
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
