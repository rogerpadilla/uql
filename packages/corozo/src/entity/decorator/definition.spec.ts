import {
  User,
  Item,
  LedgerAccount,
  TaxCategory,
  MeasureUnitCategory,
  MeasureUnit,
  Storehouse,
  ItemAdjustment,
  InventoryAdjustment,
  Tax,
  Company,
  Profile,
} from '../entityMock';
import { getEntityMeta, getEntities } from './definition';
import { IdColumn } from './idColumn';

it('entities', () => {
  const output = getEntities();
  const expected = [
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
  ];
  expect(output).toEqual(expected);
});

it('user', () => {
  const meta = getEntityMeta(User);
  expect(meta.id).toEqual({ property: 'id', name: 'id', isId: true });
  expect(meta).toEqual({
    type: User,
    name: 'User',
    isEntity: true,
    properties: {
      id: { column: { property: 'id', name: 'id', isId: true } },
      company: {
        column: { property: 'company', name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { property: 'user', name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { property: 'createdAt', name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { property: 'updatedAt', name: 'updatedAt', onUpdate: expect.any(Function) } },
      status: { column: { property: 'status', name: 'status' } },
      name: { column: { property: 'name', name: 'name' } },
      email: { column: { property: 'email', name: 'email' } },
      password: { column: { property: 'password', name: 'password' } },
      profile: {
        column: { property: 'profile', name: 'profile' },
        relation: { type: expect.any(Function), cardinality: 'oneToOne', mappedBy: 'user' },
      },
    },
  });
});

it('profile', () => {
  const meta = getEntityMeta(Profile);
  expect(meta.id).toEqual({ property: 'id', name: 'pk', isId: true });
  expect(meta).toEqual({
    type: Profile,
    name: 'user_profile',
    isEntity: true,
    properties: {
      id: { column: { property: 'id', name: 'pk', isId: true } },
      company: {
        column: { property: 'company', name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { property: 'user', name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { property: 'createdAt', name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { property: 'updatedAt', name: 'updatedAt', onUpdate: expect.any(Function) } },
      status: { column: { property: 'status', name: 'status' } },
      picture: { column: { property: 'picture', name: 'image' } },
    },
  });
});

it('item', () => {
  const meta = getEntityMeta(Item);
  expect(meta.id).toEqual({ property: 'id', name: 'id', isId: true });
  expect(meta).toEqual({
    type: Item,
    name: 'Item',
    isEntity: true,
    properties: {
      id: { column: { property: 'id', name: 'id', isId: true } },
      company: {
        column: { property: 'company', name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { property: 'user', name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { property: 'createdAt', name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { property: 'updatedAt', name: 'updatedAt', onUpdate: expect.any(Function) } },
      status: { column: { property: 'status', name: 'status' } },
      name: { column: { property: 'name', name: 'name' } },
      description: { column: { property: 'description', name: 'description' } },
      code: { column: { property: 'code', name: 'code' } },
      barcode: { column: { property: 'barcode', name: 'barcode' } },
      image: { column: { property: 'image', name: 'image' } },
      buyLedgerAccount: {
        column: { property: 'buyLedgerAccount', name: 'buyLedgerAccount' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      saleLedgerAccount: {
        column: { property: 'saleLedgerAccount', name: 'saleLedgerAccount' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      tax: {
        column: { property: 'tax', name: 'tax' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      measureUnit: {
        column: { property: 'measureUnit', name: 'measureUnit' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      buyPriceAverage: { column: { property: 'buyPriceAverage', name: 'buyPriceAverage' } },
      salePrice: { column: { property: 'salePrice', name: 'salePrice' } },
      inventoryable: { column: { property: 'inventoryable', name: 'inventoryable' } },
    },
  });
});

it('taxCategory', () => {
  const meta = getEntityMeta(TaxCategory);
  expect(meta.id).toEqual({
    property: 'pk',
    name: 'pk',
    isId: true,
    onInsert: expect.any(Function),
  });
  expect(meta).toEqual({
    type: TaxCategory,
    name: 'TaxCategory',
    isEntity: true,
    properties: {
      pk: { column: { property: 'pk', name: 'pk', isId: true, onInsert: expect.any(Function) } },
      company: {
        column: { property: 'company', name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { property: 'user', name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { property: 'createdAt', name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { property: 'updatedAt', name: 'updatedAt', onUpdate: expect.any(Function) } },
      status: { column: { property: 'status', name: 'status' } },
      name: { column: { property: 'name', name: 'name' } },
      description: { column: { property: 'description', name: 'description' } },
    },
  });
});

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getEntityMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    @IdColumn()
    id: string;
  }

  expect(() => getEntityMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});
