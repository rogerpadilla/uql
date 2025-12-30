import { expect, it } from 'bun:test';
import type { Item, ItemAdjustment, Storehouse } from '../test/index.js';
import type { QuerySortMap } from '../type/index.js';
import { escapeSqlId, flatObject, obtainAttrsPaths, unflatObjects } from './sql.util.js';

it('flatObject', () => {
  expect(flatObject(undefined)).toEqual({});
  expect(flatObject(null)).toEqual({});
  expect(flatObject({})).toEqual({});
  const sort: QuerySortMap<Item> = {
    name: 1,
    measureUnit: { name: -1, category: { creator: { profile: { picture: 1 } } } },
  };
  expect(flatObject(sort)).toEqual({
    name: 1,
    'measureUnit.name': -1,
    'measureUnit.category.creator.profile.picture': 1,
  });
});

it('unflatObjects - empty', () => {
  const res1 = unflatObjects(undefined);
  expect(res1).toBe(undefined);
  const res2 = unflatObjects([]);
  expect(res2).toEqual([]);
});

it('unflatObjects', () => {
  const source: Storehouse[] = [
    {
      id: 1,
      name: 'Auxiliar',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: null,
      creatorId: 1,
      companyId: 1,
    },
    {
      id: 2,
      name: 'Principal',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: 1578759519913,
      creatorId: 1,
      companyId: 1,
    },
  ];
  const result = unflatObjects(source);
  const expected: Storehouse[] = [
    {
      id: 1,
      name: 'Auxiliar',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: null,
      creatorId: 1,
      companyId: 1,
    },
    {
      id: 2,
      name: 'Principal',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: 1578759519913,
      creatorId: 1,
      companyId: 1,
    },
  ];
  expect(result).toEqual(expected);
});

it('unflatObjects deep', () => {
  const source = [
    {
      id: 9,
      buyPrice: 1000,
      number: 10,
      'item.id': 1,
      'item.name': 'Arepa de Yuca y Queso x 6',
      'item.createdAt': 1,
      'item.buyLedgerAccount': 1,
      'item.saleLedgerAccount': 1,
      'item.tax': 1,
      'item.companyId': 1,
      'item.measureUnit': 1,
      'item.inventoryable': 1,
      'item.buyLedgerAccount.id': 1,
      'item.buyLedgerAccount.name': 'Ventas',
      'item.saleLedgerAccount.id': 1,
      'item.saleLedgerAccount.name': 'Ventas',
      'item.tax.id': 1,
      'item.tax.name': 'IVA 0%',
      'item.tax.percentage': 0,
      'item.tax.category.pk': '1',
      'item.tax.category.name': 'Impuestos',
      'item.tax.category.description': 'Nacionales',
      'item.measureUnit.id': 1,
      'item.measureUnit.name': 'Unidad',
      'item.creatorId': null as string,
      'item.creator.id': null as string,
      'item.creator.name': null as string,
    },
    {
      id: 15,
      buyPrice: 2000,
      number: 20,
      'item.id': 2,
      'item.name': 'Pony Malta 2 litros',
      'item.createdAt': 1,
      'item.companyId': 1,
      'item.creatorId': 5,
      'item.creator.id': 5,
      'item.creator.name': 'Roshi Master',
    },
  ];
  const result = unflatObjects(source as Item[]);
  const expected: ItemAdjustment[] = [
    {
      id: 9,
      buyPrice: 1000,
      number: 10,
      item: {
        id: 1,
        name: 'Arepa de Yuca y Queso x 6',
        createdAt: 1,
        buyLedgerAccount: {
          id: 1,
          name: 'Ventas',
        },
        saleLedgerAccount: {
          id: 1,
          name: 'Ventas',
        },
        tax: {
          id: 1,
          name: 'IVA 0%',
          percentage: 0,
          category: {
            pk: '1',
            name: 'Impuestos',
            description: 'Nacionales',
          },
        },
        companyId: 1,
        measureUnit: {
          id: 1,
          name: 'Unidad',
        },
        inventoryable: 1 as any as boolean,
      },
    },
    {
      id: 15,
      buyPrice: 2000,
      number: 20,
      item: {
        id: 2,
        name: 'Pony Malta 2 litros',
        createdAt: 1,
        companyId: 1,
        creatorId: 5,
        creator: {
          id: 5,
          name: 'Roshi Master',
        },
      },
    },
  ];
  expect(result).toEqual(expected);
});

it('obtainAttrsPaths - empty', () => {
  const res1 = obtainAttrsPaths(undefined);
  expect(res1).toEqual({});
  const res2 = obtainAttrsPaths({});
  expect(res2).toEqual({});
});

it('obtainAttrsPaths - object', () => {
  const res1 = obtainAttrsPaths({
    'prop1.a.b': 1,
    'prop2.c.d': 2,
  });
  console.log('***** res1', res1);
  expect(res1).toEqual({
    'prop1.a.b': ['prop1', 'a', 'b'],
    'prop2.c.d': ['prop2', 'c', 'd'],
  });
});

it('escapeSqlId', () => {
  expect(escapeSqlId('table')).toBe('`table`');
  expect(escapeSqlId('table', '"')).toBe('"table"');
  expect(escapeSqlId('table', '`')).toBe('`table`');
  expect(escapeSqlId('my"table', '"')).toBe('"my""table"');
  expect(escapeSqlId('my`table', '`')).toBe('`my``table`');
  expect(escapeSqlId('schema.table')).toBe('`schema`.`table`');
  expect(escapeSqlId('schema.table', '"')).toBe('"schema"."table"');
  expect(escapeSqlId('schema.table', '"', true)).toBe('"schema.table"');
  expect(escapeSqlId('table', '`', false, true)).toBe('`table`.');
  expect(escapeSqlId('')).toBe('');
  expect(escapeSqlId(undefined)).toBe('');
});
