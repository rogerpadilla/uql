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
  Tag,
  ItemTag,
} from '../../test';
import { EntityGetter, EntityMeta, OnFieldCallback, QueryRaw, QueryRawFn } from '../../type';
import { getEntities, getMeta } from './definition.js';
import { Entity } from './entity.js';
import { Id } from './id.js';
import { Field } from './field.js';

it('User', () => {
  const meta = getMeta(User);

  expect(meta.fields.companyId.reference()).toBe(Company);
  expect(meta.relations.company.entity()).toBe(Company);
  expect(meta.relations.company.references).toEqual([{ local: 'companyId', foreign: 'id' }]);

  expect(meta.fields.creatorId.reference()).toBe(User);
  expect(meta.relations.creator.entity()).toBe(User);
  expect(meta.relations.creator.references).toEqual([{ local: 'creatorId', foreign: 'id' }]);

  const expectedMeta: EntityMeta<User> = {
    entity: User,
    name: 'User',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      name: { name: 'name', type: String },
      email: { name: 'email', type: String },
      password: { name: 'password', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      users: {
        cardinality: '1m',
        entity: expect.any(Function) as EntityGetter,
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
      profile: {
        cardinality: '11',
        cascade: true,
        entity: expect.any(Function) as EntityGetter,
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
    },
  };

  expect(meta).toEqual(expectedMeta);
});

it('Profile', () => {
  const meta = getMeta(Profile);
  const expectedMeta: EntityMeta<Profile> = {
    entity: Profile,
    name: 'user_profile',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'pk', type: Number, isId: true },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      picture: { name: 'image', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: '11',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('Item', () => {
  const meta = getMeta(Item);
  const expectedMeta: EntityMeta<Item> = {
    entity: Item,
    name: 'Item',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
      code: { name: 'code', type: String },
      buyLedgerAccountId: {
        name: 'buyLedgerAccountId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      saleLedgerAccountId: {
        name: 'saleLedgerAccountId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      taxId: {
        name: 'taxId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      measureUnitId: {
        name: 'measureUnitId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
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
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'buyLedgerAccountId', foreign: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'saleLedgerAccountId', foreign: 'id' }],
      },
      tax: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'taxId', foreign: 'id' }],
      },
      measureUnit: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'measureUnitId', foreign: 'id' }],
      },
      tags: {
        cardinality: 'mm',
        cascade: true,
        entity: expect.any(Function) as EntityGetter,
        through: expect.any(Function) as EntityGetter,
        references: [
          { local: 'itemId', foreign: 'id' },
          { local: 'tagId', foreign: 'id' },
        ],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('Tag', () => {
  const meta = getMeta(Tag);
  const expectedMeta: EntityMeta<Tag> = {
    entity: Tag,
    id: 'id',
    name: 'Tag',
    processed: true,
    fields: {
      id: {
        isId: true,
        name: 'id',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        reference: expect.any(Function) as EntityGetter,
        type: Number,
      },
      createdAt: {
        name: 'createdAt',
        onInsert: expect.any(Function) as OnFieldCallback,
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
          alias: undefined,
          value: expect.any(Function) as QueryRawFn,
        },
      },
      updatedAt: {
        name: 'updatedAt',
        onUpdate: expect.any(Function) as OnFieldCallback,
        type: Number,
      },
      creatorId: {
        name: 'creatorId',
        reference: expect.any(Function) as EntityGetter,
        type: Number,
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      items: {
        cardinality: 'mm',
        entity: expect.any(Function) as EntityGetter,
        mappedBy: 'tags',
        through: expect.any(Function) as EntityGetter,
        references: [
          { local: 'tagId', foreign: 'id' },
          { local: 'itemId', foreign: 'id' },
        ],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('ItemTag', () => {
  const meta = getMeta(ItemTag);
  const expectedMeta: EntityMeta<ItemTag> = {
    entity: ItemTag,
    name: 'ItemTag',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      itemId: {
        name: 'itemId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      tagId: {
        name: 'tagId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
    },
    relations: {
      item: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      tag: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'tagId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('TaxCategory', () => {
  const meta = getMeta(TaxCategory);
  const expectedMeta: EntityMeta<TaxCategory> = {
    entity: TaxCategory,
    name: 'TaxCategory',
    id: 'pk',
    processed: true,
    fields: {
      pk: { name: 'pk', type: String, isId: true, onInsert: expect.any(Function) as OnFieldCallback },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('Tax', () => {
  const meta = getMeta(Tax);
  const expectedMeta: EntityMeta<Tax> = {
    entity: Tax,
    name: 'Tax',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      categoryId: {
        name: 'categoryId',
        reference: expect.any(Function) as EntityGetter,
        type: String,
      },
      percentage: {
        name: 'percentage',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      category: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [
          {
            local: 'categoryId',
            foreign: 'pk',
          },
        ],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('ItemAdjustment', () => {
  const meta = getMeta(ItemAdjustment);
  const expectedMeta: EntityMeta<ItemAdjustment> = {
    entity: ItemAdjustment,
    name: 'ItemAdjustment',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      buyPrice: {
        name: 'buyPrice',
        type: Number,
      },
      inventoryAdjustmentId: {
        name: 'inventoryAdjustmentId',
        reference: expect.any(Function) as EntityGetter,
        type: Number,
      },
      itemId: {
        name: 'itemId',
        reference: expect.any(Function) as EntityGetter,
        type: Number,
      },
      number: {
        name: 'number',
        type: Number,
      },
      storehouseId: {
        name: 'storehouseId',
        reference: expect.any(Function) as EntityGetter,
        type: Number,
      },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
    },
    relations: {
      storehouse: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'storehouseId', foreign: 'id' }],
      },
      item: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      inventoryAdjustment: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [
          {
            local: 'inventoryAdjustmentId',
            foreign: 'id',
          },
        ],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('InventoryAdjustment', () => {
  const meta = getMeta(InventoryAdjustment);
  const expectedMeta: EntityMeta<InventoryAdjustment> = {
    entity: InventoryAdjustment,
    name: 'InventoryAdjustment',
    id: 'id',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      description: { name: 'description', type: String },
      date: { name: 'date', type: Date },
    },
    relations: {
      itemAdjustments: {
        cardinality: '1m',
        cascade: true,
        entity: expect.any(Function) as EntityGetter,
        mappedBy: 'inventoryAdjustment',
        references: [{ local: 'id', foreign: 'inventoryAdjustmentId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('MeasureUnitCategory', () => {
  const meta = getMeta(MeasureUnitCategory);
  const expectedMeta: EntityMeta<MeasureUnitCategory> = {
    entity: MeasureUnitCategory,
    name: 'MeasureUnitCategory',
    id: 'id',
    softDelete: 'deletedAt',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      name: { name: 'name', type: String },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      deletedAt: { name: 'deletedAt', type: Number, onDelete: expect.any(Function) as OnFieldCallback },
    },
    relations: {
      measureUnits: {
        cardinality: '1m',
        entity: expect.any(Function) as EntityGetter,
        mappedBy: 'categoryId',
        references: [{ local: 'id', foreign: 'categoryId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
});

it('MeasureUnit', () => {
  const meta = getMeta(MeasureUnit);
  const expectedMeta: EntityMeta<MeasureUnit> = {
    entity: MeasureUnit,
    name: 'MeasureUnit',
    id: 'id',
    softDelete: 'deletedAt',
    processed: true,
    fields: {
      id: { name: 'id', type: Number, isId: true },
      name: { name: 'name', type: String },
      categoryId: {
        name: 'categoryId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      companyId: {
        name: 'companyId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      creatorId: {
        name: 'creatorId',
        type: Number,
        reference: expect.any(Function) as EntityGetter,
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.any(Function) as OnFieldCallback },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.any(Function) as OnFieldCallback },
      deletedAt: { name: 'deletedAt', type: Number, onDelete: expect.any(Function) as OnFieldCallback },
    },
    relations: {
      category: {
        cardinality: 'm1',
        cascade: 'persist',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'categoryId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.any(Function) as EntityGetter,
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  };
  expect(meta).toEqual(expectedMeta);
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
    ].sort()
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

it('one @Id', () => {
  expect(() => {
    class SomeEntity {
      @Id()
      idOne: string;
      @Id()
      idTwo: string;
    }
  }).toThrow(`'SomeEntity' must have a single field decorated with @Id`);
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
