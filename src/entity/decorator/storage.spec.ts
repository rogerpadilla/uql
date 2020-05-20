import {
  User,
  Item,
  BaseEntity,
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
import { getEntityMeta, getEntities } from './storage';
import { PrimaryColumn } from './primaryColumn';

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
  expect(meta).toEqual({
    type: User,
    name: 'user',
    id: 'id',
    isEntity: true,
    properties: {
      id: { column: { name: 'id', mode: 'read' } },
      company: {
        column: { name: 'company', mode: 'insert' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: { relation: { type: expect.any(Function), cardinality: 'manyToOne' }, column: { name: 'user', mode: 'insert' } },
      createdAt: { column: { name: 'createdAt', mode: 'insert' } },
      updatedAt: { column: { name: 'updatedAt', mode: 'update' } },
      status: { column: { name: 'status' } },
      name: { column: { name: 'name' } },
      email: { column: { name: 'email' } },
      password: { column: { name: 'password' } },
      profile: {
        column: { name: 'profile' },
        relation: { type: expect.any(Function), cardinality: 'oneToOne', mappedBy: 'user' },
      },
    },
  });
});

it('profile', () => {
  const meta = getEntityMeta(Profile);
  expect(meta).toEqual({
    type: Profile,
    name: 'user_profile',
    id: 'id',
    isEntity: true,
    properties: {
      id: { column: { name: 'pk', mode: 'read' } },
      company: {
        column: { name: 'company', mode: 'insert' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: { relation: { type: expect.any(Function), cardinality: 'manyToOne' }, column: { name: 'user', mode: 'insert' } },
      createdAt: { column: { name: 'createdAt', mode: 'insert' } },
      updatedAt: { column: { name: 'updatedAt', mode: 'update' } },
      status: { column: { name: 'status' } },
      picture: { column: { name: 'image' } },
    },
  });
});

it('item', () => {
  const meta = getEntityMeta(Item);
  expect(meta).toEqual({
    type: Item,
    name: 'Item',
    id: 'id',
    isEntity: true,
    properties: {
      id: { column: { name: 'id', mode: 'read' } },
      company: {
        column: { name: 'company', mode: 'insert' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: { relation: { type: expect.any(Function), cardinality: 'manyToOne' }, column: { name: 'user', mode: 'insert' } },
      createdAt: { column: { name: 'createdAt', mode: 'insert' } },
      updatedAt: { column: { name: 'updatedAt', mode: 'update' } },
      status: { column: { name: 'status' } },
      name: { column: { name: 'name' } },
      description: { column: { name: 'description' } },
      code: { column: { name: 'code' } },
      barcode: { column: { name: 'barcode' } },
      image: { column: { name: 'image' } },
      buyLedgerAccount: {
        column: { name: 'buyLedgerAccount' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      saleLedgerAccount: {
        column: { name: 'saleLedgerAccount' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      tax: { column: { name: 'tax' }, relation: { type: expect.any(Function), cardinality: 'manyToOne' } },
      measureUnit: { column: { name: 'measureUnit' }, relation: { type: expect.any(Function), cardinality: 'manyToOne' } },
      buyPriceAverage: { column: { name: 'buyPriceAverage', mode: 'read' } },
      salePrice: { column: { name: 'salePrice' } },
      inventoryable: { column: { name: 'inventoryable' } },
    },
  });
});

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getEntityMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    @PrimaryColumn()
    id: string;
  }

  expect(() => getEntityMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});
