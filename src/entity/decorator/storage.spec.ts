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
} from '../entityMock';
import { getEntityMeta, getEntities } from './storage';

it('entities', () => {
  const output = getEntities();
  const expected = new Map<Function, undefined>([
    [BaseEntity, undefined],
    [Company, undefined],
    [User, undefined],
    [LedgerAccount, undefined],
    [TaxCategory, undefined],
    [Tax, undefined],
    [MeasureUnitCategory, undefined],
    [MeasureUnit, undefined],
    [Storehouse, undefined],
    [Item, undefined],
    [ItemAdjustment, undefined],
    [InventoryAdjustment, undefined],
  ]).keys();
  expect(output).toEqual(expected);
});

it('user', () => {
  const meta = getEntityMeta(User);
  expect(meta).toEqual({
    id: 'id',
    columns: {
      company: {
        mode: 'insert',
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
      createdAt: {
        mode: 'insert',
      },
      email: {},
      id: {
        mode: 'read',
      },
      name: {},
      password: {},
      status: {},
      updatedAt: {
        mode: 'update',
      },
      user: {
        mode: 'insert',
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
    },
    merged: true,
  });
});

it('item', () => {
  const meta = getEntityMeta(Item);
  expect(meta).toEqual({
    id: 'id',
    columns: {
      barcode: {},
      buyLedgerAccount: {
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
      buyPriceAverage: {
        mode: 'read',
      },
      code: {},
      company: {
        mode: 'insert',
        relation: { cardinality: 'manyToOne', type: expect.any(Function) },
      },
      createdAt: {
        mode: 'insert',
      },
      description: {},
      id: {
        mode: 'read',
      },
      image: {},
      inventoryable: {},
      measureUnit: {
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
      name: {},
      saleLedgerAccount: {
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
      salePrice: {},
      status: {},
      tax: {
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
      updatedAt: {
        mode: 'update',
      },
      user: {
        mode: 'insert',
        relation: {
          cardinality: 'manyToOne',
          type: expect.any(Function),
        },
      },
    },
    merged: true,
  });
});
