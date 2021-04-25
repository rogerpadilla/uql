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
} from '../../test';
import { Id } from './id';
import { getEntities, getEntityMeta } from './definition';

it('user', () => {
  const meta = getEntityMeta(User);
  expect(meta).toEqual({
    type: User,
    name: 'User',
    id: { property: 'id', name: 'id' },
    properties: {
      id: { name: 'id', type: Object, isId: true },
      company: {
        name: 'company',
        type: Object,
      },
      user: {
        name: 'user',
        type: Object,
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
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      profile: {
        cardinality: 'oneToOne',
        mappedBy: 'user',
        type: expect.any(Function),
      },
    },
  });
});

it('profile', () => {
  const meta = getEntityMeta(Profile);
  expect(meta).toEqual({
    type: Profile,
    name: 'user_profile',
    id: { property: 'id', name: 'pk' },
    properties: {
      id: { name: 'pk', type: String, isId: true },
      company: {
        name: 'company',
        type: Object,
      },
      user: {
        name: 'user',
        type: Object,
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
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
    },
  });
});

it('item', () => {
  const meta = getEntityMeta(Item);
  expect(meta).toEqual({
    type: Item,
    name: 'Item',
    id: { property: 'id', name: 'id' },
    properties: {
      id: { name: 'id', type: Object, isId: true },
      company: {
        name: 'company',
        type: Object,
      },
      user: {
        name: 'user',
        type: Object,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      status: { name: 'status', type: Number },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
      code: { name: 'code', type: String },
      barcode: { name: 'barcode', type: String },
      image: { name: 'image', type: String },
      buyLedgerAccount: {
        name: 'buyLedgerAccount',
        type: LedgerAccount,
      },
      saleLedgerAccount: {
        name: 'saleLedgerAccount',
        type: LedgerAccount,
      },
      tax: {
        name: 'tax',
        type: Tax,
      },
      measureUnit: {
        name: 'measureUnit',
        type: MeasureUnit,
      },
      buyPriceAverage: { name: 'buyPriceAverage', type: Number },
      salePrice: { name: 'salePrice', type: Number },
      inventoryable: { name: 'inventoryable', type: Boolean },
    },
    relations: {
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      buyLedgerAccount: {
        type: expect.any(Function),
        cardinality: 'manyToOne',
      },
      saleLedgerAccount: {
        type: expect.any(Function),
        cardinality: 'manyToOne',
      },
      tax: {
        type: expect.any(Function),
        cardinality: 'manyToOne',
      },
      measureUnit: {
        type: expect.any(Function),
        cardinality: 'manyToOne',
      },
    },
  });
});

it('taxCategory', () => {
  const meta = getEntityMeta(TaxCategory);
  expect(meta).toEqual({
    type: TaxCategory,
    name: 'TaxCategory',
    id: { property: 'pk', name: 'pk' },
    properties: {
      pk: { name: 'pk', type: String, isId: true, onInsert: expect.any(Function) },
      company: {
        name: 'company',
        type: Object,
      },
      user: {
        name: 'user',
        type: Object,
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
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
    },
  });
});

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getEntityMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    @Id()
    id: string;
  }

  expect(() => getEntityMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
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
    Item,
    ItemAdjustment,
    InventoryAdjustment,
  ]);
});
