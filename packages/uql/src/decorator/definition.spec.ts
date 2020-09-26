import { User, Item, TaxCategory, Profile } from 'uql/mock';
import { Id } from './id';
import { getEntityMeta } from './definition';

it('user', () => {
  const meta = getEntityMeta(User);
  expect(meta).toEqual({
    type: User,
    name: 'User',
    id: { property: 'id', name: 'id' },
    properties: {
      id: { name: 'id', isId: true },
      company: {
        name: 'company',
      },
      user: {
        name: 'user',
      },
      createdAt: { name: 'createdAt', onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', onUpdate: expect.any(Function) },
      status: { name: 'status' },
      name: { name: 'name' },
      email: { name: 'email' },
      password: { name: 'password' },
      profile: {
        name: 'profile',
      },
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
      id: { name: 'pk', isId: true },
      company: {
        name: 'company',
      },
      user: {
        name: 'user',
      },
      createdAt: { name: 'createdAt', onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', onUpdate: expect.any(Function) },
      status: { name: 'status' },
      picture: { name: 'image' },
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
      id: { name: 'id', isId: true },
      company: {
        name: 'company',
      },
      user: {
        name: 'user',
      },
      createdAt: { name: 'createdAt', onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', onUpdate: expect.any(Function) },
      status: { name: 'status' },
      name: { name: 'name' },
      description: { name: 'description' },
      code: { name: 'code' },
      barcode: { name: 'barcode' },
      image: { name: 'image' },
      buyLedgerAccount: {
        name: 'buyLedgerAccount',
      },
      saleLedgerAccount: {
        name: 'saleLedgerAccount',
      },
      tax: {
        name: 'tax',
      },
      measureUnit: {
        name: 'measureUnit',
      },
      buyPriceAverage: { name: 'buyPriceAverage' },
      salePrice: { name: 'salePrice' },
      inventoryable: { name: 'inventoryable' },
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
      pk: { name: 'pk', isId: true, onInsert: expect.any(Function) },
      company: {
        name: 'company',
      },
      user: {
        name: 'user',
      },
      createdAt: { name: 'createdAt', onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', onUpdate: expect.any(Function) },
      status: { name: 'status' },
      name: { name: 'name' },
      description: { name: 'description' },
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
