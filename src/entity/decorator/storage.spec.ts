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
    name: 'User',
    id: 'id',
    columns: {
      company: {
        name: 'company',
        mode: 'insert',
      },
      createdAt: {
        name: 'createdAt',
        mode: 'insert',
      },
      email: {
        name: 'email',
      },
      id: {
        name: 'id',
        mode: 'read',
      },
      name: {
        name: 'name',
      },
      password: {
        name: 'password',
      },
      status: {
        name: 'status',
      },
      updatedAt: {
        name: 'updatedAt',
        mode: 'update',
      },
      profile: {
        name: 'profile',
      },
      user: {
        name: 'user',
        mode: 'insert',
      },
    },
    relations: {
      profile: {
        cardinality: 'oneToOne',
        mappedBy: 'user',
        type: expect.any(Function),
      },
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
    },
    isEntity: true,
  });
});

it('item', () => {
  const meta = getEntityMeta(Item);
  expect(meta).toEqual({
    type: Item,
    name: 'Item',
    id: 'id',
    columns: {
      barcode: {
        name: 'barcode',
      },
      buyLedgerAccount: {
        name: 'buyLedgerAccount',
      },
      buyPriceAverage: {
        name: 'buyPriceAverage',
        mode: 'read',
      },
      code: {
        name: 'code',
      },
      company: {
        name: 'company',
        mode: 'insert',
      },
      createdAt: {
        name: 'createdAt',
        mode: 'insert',
      },
      description: {
        name: 'description',
      },
      id: {
        name: 'id',
        mode: 'read',
      },
      image: {
        name: 'image',
      },
      inventoryable: {
        name: 'inventoryable',
      },
      measureUnit: {
        name: 'measureUnit',
      },
      name: {
        name: 'name',
      },
      saleLedgerAccount: {
        name: 'saleLedgerAccount',
      },
      salePrice: {
        name: 'salePrice',
      },
      status: {
        name: 'status',
      },
      tax: {
        name: 'tax',
      },
      updatedAt: {
        name: 'updatedAt',
        mode: 'update',
      },
      user: {
        name: 'user',
        mode: 'insert',
      },
    },
    relations: {
      buyLedgerAccount: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      measureUnit: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      saleLedgerAccount: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      tax: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      company: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
      user: {
        cardinality: 'manyToOne',
        type: expect.any(Function),
      },
    },
    isEntity: true,
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
