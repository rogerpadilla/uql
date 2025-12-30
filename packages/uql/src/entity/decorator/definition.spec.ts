import { expect, it } from 'bun:test';
import {
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  ItemTag,
  LedgerAccount,
  MeasureUnit,
  MeasureUnitCategory,
  Profile,
  Storehouse,
  Tag,
  Tax,
  TaxCategory,
  User,
  UserWithNonUpdatableId,
} from '../../test/index.js';
import { type IdKey, QueryRaw } from '../../type/index.js';
import { getEntities, getMeta } from './definition.js';
import { Entity } from './entity.js';
import { Field } from './field.js';

it('User', () => {
  const meta = getMeta(User);

  expect(meta.fields.companyId.reference()).toBe(Company);
  expect(meta.relations.company.entity()).toBe(Company);
  expect(meta.relations.company.references).toEqual([{ local: 'companyId', foreign: 'id' }]);

  expect(meta.fields.creatorId.reference()).toBe(User);
  expect(meta.relations.creator.entity()).toBe(User);
  expect(meta.relations.creator.references).toEqual([{ local: 'creatorId', foreign: 'id' }]);

  const expectedMeta = {
    entity: User,
    name: 'User',
    id: 'id' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      name: { name: 'name', type: String },
      email: { name: 'email', type: String, updatable: false },
      password: { name: 'password', eager: false, type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      users: {
        cardinality: '1m',
        entity: expect.any(Function),
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
      profile: {
        cardinality: '11',
        cascade: true,
        entity: expect.any(Function),
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
    },
  };

  expect(meta).toMatchObject(expectedMeta);
});

it('Profile', () => {
  const meta = getMeta(Profile);
  const expectedMeta = {
    entity: Profile,
    name: 'user_profile',
    id: 'pk' as IdKey<Profile>,
    processed: true as const,
    fields: {
      pk: { name: 'pk', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      picture: { name: 'image', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: '11',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('Item', () => {
  const meta = getMeta(Item);
  const expectedMeta = {
    entity: Item,
    name: 'Item',
    id: 'id' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
      code: { name: 'code', type: String },
      buyLedgerAccountId: {
        name: 'buyLedgerAccountId',
        type: Number,
        reference: expect.any(Function),
      },
      saleLedgerAccountId: {
        name: 'saleLedgerAccountId',
        type: Number,
        reference: expect.any(Function),
      },
      taxId: {
        name: 'taxId',
        type: Number,
        reference: expect.any(Function),
      },
      measureUnitId: {
        name: 'measureUnitId',
        type: Number,
        reference: expect.any(Function),
      },
      salePrice: { name: 'salePrice', type: Number },
      inventoryable: { name: 'inventoryable', type: Boolean },
      tagsCount: {
        name: 'tagsCount',
        type: Number,
        virtual: expect.any(QueryRaw),
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'buyLedgerAccountId', foreign: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'saleLedgerAccountId', foreign: 'id' }],
      },
      tax: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'taxId', foreign: 'id' }],
      },
      measureUnit: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'measureUnitId', foreign: 'id' }],
      },
      tags: {
        cardinality: 'mm',
        cascade: true,
        entity: expect.any(Function),
        through: expect.any(Function),
        references: [
          { local: 'itemId', foreign: 'id' },
          { local: 'tagId', foreign: 'id' },
        ],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('Tag', () => {
  const meta = getMeta(Tag);
  const expectedMeta = {
    entity: Tag,
    id: 'id' as const,
    name: 'Tag',
    processed: true as const,
    fields: {
      id: {
        isId: true as const,
        name: 'id',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        reference: expect.any(Function),
        type: Number,
      },
      createdAt: {
        name: 'createdAt',
        onInsert: expect.any(Function),
        type: Number,
      },
      name: {
        name: 'name',
        type: String,
      },
      itemsCount: {
        name: 'itemsCount',
        type: Number,
        virtual: {
          alias: undefined as string,
          value: expect.any(Function),
        },
      },
      updatedAt: {
        name: 'updatedAt',
        onUpdate: expect.any(Function),
        type: Number,
      },
      creatorId: {
        name: 'creatorId',
        reference: expect.any(Function),
        type: Number,
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      items: {
        cardinality: 'mm',
        entity: expect.any(Function),
        mappedBy: 'tags',
        through: expect.any(Function),
        references: [
          { local: 'tagId', foreign: 'id' },
          { local: 'itemId', foreign: 'id' },
        ],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('ItemTag', () => {
  const meta = getMeta(ItemTag);
  const expectedMeta = {
    entity: ItemTag,
    name: 'ItemTag',
    id: 'id' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      itemId: {
        name: 'itemId',
        type: Number,
        reference: expect.any(Function),
      },
      tagId: {
        name: 'tagId',
        type: Number,
        reference: expect.any(Function),
      },
    },
    relations: {
      item: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      tag: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'tagId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('TaxCategory', () => {
  const meta = getMeta(TaxCategory);
  const expectedMeta = {
    entity: TaxCategory,
    name: 'TaxCategory',
    id: 'pk' as const,
    processed: true as const,
    fields: {
      pk: { name: 'pk', type: String, isId: true as const, onInsert: expect.any(Function) },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('Tax', () => {
  const meta = getMeta(Tax);
  const expectedMeta = {
    entity: Tax,
    name: 'Tax',
    id: 'id' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      categoryId: {
        name: 'categoryId',
        reference: expect.any(Function),
        type: String,
      },
      percentage: {
        name: 'percentage',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      category: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [
          {
            local: 'categoryId',
            foreign: 'pk',
          },
        ],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('ItemAdjustment', () => {
  const meta = getMeta(ItemAdjustment);
  const expectedMeta = {
    entity: ItemAdjustment,
    name: 'ItemAdjustment',
    id: 'id' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      buyPrice: {
        name: 'buyPrice',
        type: Number,
      },
      inventoryAdjustmentId: {
        name: 'inventoryAdjustmentId',
        reference: expect.any(Function),
        type: Number,
      },
      itemId: {
        name: 'itemId',
        reference: expect.any(Function),
        type: Number,
      },
      number: {
        name: 'number',
        type: Number,
      },
      storehouseId: {
        name: 'storehouseId',
        reference: expect.any(Function),
        type: Number,
      },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
    },
    relations: {
      storehouse: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'storehouseId', foreign: 'id' }],
      },
      item: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      inventoryAdjustment: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [
          {
            local: 'inventoryAdjustmentId',
            foreign: 'id',
          },
        ],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('InventoryAdjustment', () => {
  const meta = getMeta(InventoryAdjustment);
  const expectedMeta = {
    entity: InventoryAdjustment,
    name: 'InventoryAdjustment',
    id: 'id' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      description: { name: 'description', type: String },
      date: { name: 'date', type: Date },
    },
    relations: {
      itemAdjustments: {
        cardinality: '1m',
        cascade: true,
        entity: expect.any(Function),
        mappedBy: 'inventoryAdjustment',
        references: [{ local: 'id', foreign: 'inventoryAdjustmentId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('MeasureUnitCategory', () => {
  const meta = getMeta(MeasureUnitCategory);
  const expectedMeta = {
    entity: MeasureUnitCategory,
    name: 'MeasureUnitCategory',
    id: 'id' as const,
    softDelete: 'deletedAt' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      name: { name: 'name', type: String },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      deletedAt: { name: 'deletedAt', type: Number, onDelete: expect.any(Function) },
    },
    relations: {
      measureUnits: {
        cardinality: '1m',
        entity: expect.any(Function),
        mappedBy: 'categoryId',
        references: [{ local: 'id', foreign: 'categoryId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
});

it('MeasureUnit', () => {
  const meta = getMeta(MeasureUnit);
  const expectedMeta = {
    entity: MeasureUnit,
    name: 'MeasureUnit',
    id: 'id' as const,
    softDelete: 'deletedAt' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      name: { name: 'name', type: String },
      categoryId: {
        name: 'categoryId',
        type: Number,
        reference: expect.any(Function),
      },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function),
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) },
      deletedAt: { name: 'deletedAt', type: Number, onDelete: expect.any(Function) },
    },
    relations: {
      category: {
        cardinality: 'm1',
        cascade: 'persist',
        entity: expect.any(Function),
        references: [{ local: 'categoryId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toMatchObject(expectedMeta);
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
  expect(entities.sort()).toEqual(
    [
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
      Tag,
      ItemTag,
      ItemAdjustment,
      InventoryAdjustment,
      UserWithNonUpdatableId,
    ].sort(),
  );
});

it('no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field()
      id: string;
    }
  }).toThrow(`'SomeEntity' must have one field decorated with @Id`);
});

it('no fields', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id: string;
    }
  }).toThrow(`'SomeEntity' must have fields`);
});

it('softDelete onDelete', () => {
  expect(() => {
    @Entity({ softDelete: true })
    class SomeEntity {
      @Field()
      id: string;
    }
  }).toThrow(`'SomeEntity' must have one field with 'onDelete' to enable 'softDelete'`);
});

it('max 1 onDelete', () => {
  expect(() => {
    @Entity({ softDelete: true })
    class SomeEntity {
      @Field({ onDelete: Date.now })
      deletedAt: number;
      @Field({ onDelete: () => true })
      deleted: boolean;
    }
  }).toThrow(`'SomeEntity' must have one field with 'onDelete' as maximum`);
});
