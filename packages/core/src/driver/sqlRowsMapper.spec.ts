import { Item, Storehouse, ItemAdjustment, User } from '../test';
import { mapRows } from './sqlRowsMapper';

it('map rows - empty', () => {
  const res1 = mapRows(undefined);
  expect(res1).toBe(undefined);
  const res2 = mapRows([]);
  expect(res2).toEqual([]);
});

it('mapRows', () => {
  const source: Storehouse[] = [
    {
      id: '1',
      name: 'Auxiliar',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: null,
      userId: '1',
      companyId: '1',
      status: null,
    },
    {
      id: '2',
      name: 'Principal',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: 1578759519913,
      userId: '1',
      companyId: '1',
      status: null,
    },
  ];
  const result = mapRows(source);
  const expected: Storehouse[] = [
    {
      id: '1',
      name: 'Auxiliar',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: null,
      userId: '1',
      companyId: '1',
      status: null,
    },
    {
      id: '2',
      name: 'Principal',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: 1578759519913,
      userId: '1',
      companyId: '1',
      status: null,
    },
  ];
  expect(result).toEqual(expected);
});

it('mapRows deep populate', () => {
  const source = [
    {
      id: '9',
      buyPrice: 1000,
      number: 10,
      'item.id': '1',
      'item.name': 'Arepa de Yuca y Queso x 6',
      'item.createdAt': 1,
      'item.buyLedgerAccount': '1',
      'item.saleLedgerAccount': '1',
      'item.tax': '1',
      'item.companyId': '1',
      'item.measureUnit': '1',
      'item.inventoryable': 1,
      'item.buyLedgerAccount.id': '1',
      'item.buyLedgerAccount.name': 'Ventas',
      'item.saleLedgerAccount.id': '1',
      'item.saleLedgerAccount.name': 'Ventas',
      'item.tax.id': '1',
      'item.tax.name': 'IVA 0%',
      'item.tax.percentage': 0,
      'item.tax.category.id': '1',
      'item.tax.category.name': 'Impuestos',
      'item.tax.category.description': 'Nacionales',
      'item.measureUnit.id': '1',
      'item.measureUnit.name': 'Unidad',
      'item.userId': null as string,
      'item.user.id': null as string,
      'item.user.name': null as string,
    },
    {
      id: '15',
      buyPrice: 2000,
      number: 20,
      'item.id': '2',
      'item.name': 'Pony Malta 2 litros',
      'item.createdAt': 1,
      'item.companyId': '1',
      'item.userId': '5',
      'item.user.id': '5',
      'item.user.name': 'Roshi Master',
    },
  ];
  const result = mapRows(source as Item[]);
  const expected: ItemAdjustment[] = [
    {
      id: '9',
      buyPrice: 1000,
      number: 10,
      item: {
        id: '1',
        name: 'Arepa de Yuca y Queso x 6',
        createdAt: 1,
        buyLedgerAccount: {
          id: '1',
          name: 'Ventas',
        },
        saleLedgerAccount: {
          id: '1',
          name: 'Ventas',
        },
        tax: {
          id: '1',
          name: 'IVA 0%',
          percentage: 0,
          category: {
            id: '1',
            name: 'Impuestos',
            description: 'Nacionales',
          },
        },
        companyId: '1',
        measureUnit: {
          id: '1',
          name: 'Unidad',
        },
        inventoryable: (1 as any) as boolean,
      },
    },
    {
      id: '15',
      buyPrice: 2000,
      number: 20,
      item: {
        id: '2',
        name: 'Pony Malta 2 litros',
        createdAt: 1,
        companyId: '1',
        userId: '5',
        user: {
          id: '5',
          name: 'Roshi Master',
        },
      },
    },
  ];
  expect(result).toEqual(expected);
});
