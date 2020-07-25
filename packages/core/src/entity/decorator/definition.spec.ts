import { User, Item, TaxCategory, Profile } from '../entityMock';
import { getEntityMeta } from './definition';
import { IdColumn } from './idColumn';

it('user', () => {
  const meta = getEntityMeta(User);
  expect(meta).toEqual({
    type: User,
    name: 'User',
    id: { property: 'id', name: 'id' },
    properties: {
      id: { column: { name: 'id', isId: true } },
      company: {
        column: { name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { name: 'updatedAt', onUpdate: expect.any(Function) } },
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
    id: { property: 'id', name: 'pk' },
    properties: {
      id: { column: { name: 'pk', isId: true } },
      company: {
        column: { name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { name: 'updatedAt', onUpdate: expect.any(Function) } },
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
    id: { property: 'id', name: 'id' },
    properties: {
      id: { column: { name: 'id', isId: true } },
      company: {
        column: { name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { name: 'updatedAt', onUpdate: expect.any(Function) } },
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
      tax: {
        column: { name: 'tax' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      measureUnit: {
        column: { name: 'measureUnit' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      buyPriceAverage: { column: { name: 'buyPriceAverage' } },
      salePrice: { column: { name: 'salePrice' } },
      inventoryable: { column: { name: 'inventoryable' } },
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
      pk: { column: { name: 'pk', isId: true, onInsert: expect.any(Function) } },
      company: {
        column: { name: 'company' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      user: {
        column: { name: 'user' },
        relation: { type: expect.any(Function), cardinality: 'manyToOne' },
      },
      createdAt: { column: { name: 'createdAt', onInsert: expect.any(Function) } },
      updatedAt: { column: { name: 'updatedAt', onUpdate: expect.any(Function) } },
      status: { column: { name: 'status' } },
      name: { column: { name: 'name' } },
      description: { column: { name: 'description' } },
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
