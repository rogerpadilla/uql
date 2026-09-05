import { expect, it } from 'vitest';
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
import { type EntityMeta, type IdKey, QueryRaw, RAW_VALUE } from '../../type/index.js';
import { getKeys } from '../../util/index.js';
import { Entity, Field, Filter, Id, ManyToMany, ManyToOne, OneToMany } from '../index.js';
import { getEntities, getMeta } from './definition.js';

it('User', () => {
  const meta = getMeta(User);

  expect(meta.fields.companyId!.references!()).toBe(Company);
  expect(meta.relations.company!.entity!()).toBe(Company);
  expect(meta.relations.company!.references).toEqual([{ local: 'companyId', foreign: 'id' }]);

  expect(meta.fields.creatorId!.references!()).toBe(User);
  expect(meta.relations.creator!.entity!()).toBe(User);
  expect(meta.relations.creator!.references).toEqual([{ local: 'creatorId', foreign: 'id' }]);

  const expectedMeta = {
    entity: User,
    name: 'User',
    ids: ['id'] as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      email: { name: 'email', type: String, updatable: false },
      password: { name: 'password', eager: false, type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      users: {
        cardinality: '1m',
        entity: expect.anything(),
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
      profile: {
        cardinality: '11',
        cascade: true,
        entity: expect.anything(),
        mappedBy: 'creator',
        references: [{ local: 'id', foreign: 'creatorId' }],
      },
    },
  } satisfies Partial<EntityMeta<User>>;

  expect(meta).toMatchObject(expectedMeta);
});

it('Profile', () => {
  const meta = getMeta(Profile);
  const expectedMeta = {
    entity: Profile,
    name: 'user_profile',
    ids: ['pk' as IdKey<Profile>],
    processed: true as const,
    fields: {
      pk: { name: 'pk', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      picture: { name: 'image', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: '11',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<Profile>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('Item', () => {
  const meta = getMeta(Item);
  const expectedMeta = {
    entity: Item,
    name: 'Item',
    ids: ['id' as const],
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
      code: { name: 'code', type: String },
      buyLedgerAccountId: {
        name: 'buyLedgerAccountId',
        references: expect.anything(),
      },
      saleLedgerAccountId: {
        name: 'saleLedgerAccountId',
        references: expect.anything(),
      },
      taxId: {
        name: 'taxId',
        references: expect.anything(),
      },
      measureUnitId: {
        name: 'measureUnitId',
        references: expect.anything(),
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
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      buyLedgerAccount: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'buyLedgerAccountId', foreign: 'id' }],
      },
      saleLedgerAccount: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'saleLedgerAccountId', foreign: 'id' }],
      },
      tax: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'taxId', foreign: 'id' }],
      },
      measureUnit: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'measureUnitId', foreign: 'id' }],
      },
      tags: {
        cardinality: 'mm',
        cascade: true,
        entity: expect.anything(),
        through: expect.anything(),
        references: [
          { local: 'itemId', foreign: 'id' },
          { local: 'tagId', foreign: 'id' },
        ],
      },
    },
  } satisfies Partial<EntityMeta<Item>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('Tag', () => {
  const meta = getMeta(Tag);
  const expectedMeta = {
    entity: Tag,
    ids: ['id' as const],
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
        references: expect.anything(),
      },
      createdAt: {
        name: 'createdAt',
        onInsert: expect.anything(),
        type: Number,
      },
      name: {
        name: 'name',
        type: String,
      },
      itemsCount: {
        name: 'itemsCount',
        type: Number,
        virtual: expect.objectContaining({
          [RAW_VALUE]: expect.any(Function),
        }),
      },
      updatedAt: {
        name: 'updatedAt',
        onUpdate: expect.anything(),
        type: Number,
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      items: {
        cardinality: 'mm',
        entity: expect.anything(),
        mappedBy: 'tags',
        through: expect.anything(),
        references: [
          { local: 'tagId', foreign: 'id' },
          { local: 'itemId', foreign: 'id' },
        ],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<Tag>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('ItemTag', () => {
  const meta = getMeta(ItemTag);
  const expectedMeta = {
    entity: ItemTag,
    name: 'ItemTag',
    ids: ['id' as const],
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      itemId: {
        name: 'itemId',
        references: expect.anything(),
      },
      tagId: {
        name: 'tagId',
        references: expect.anything(),
      },
    },
    relations: {
      item: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      tag: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'tagId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<ItemTag>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('TaxCategory', () => {
  const meta = getMeta(TaxCategory);
  const expectedMeta = {
    entity: TaxCategory,
    name: 'TaxCategory',
    ids: ['pk' as const],
    processed: true as const,
    fields: {
      pk: { name: 'pk', type: String, isId: true as const, onInsert: expect.anything() },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<TaxCategory>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('Tax', () => {
  const meta = getMeta(Tax);
  const expectedMeta = {
    entity: Tax,
    name: 'Tax',
    ids: ['id' as const],
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      categoryId: {
        name: 'categoryId',
        references: expect.anything(),
      },
      percentage: {
        name: 'percentage',
        type: Number,
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      name: { name: 'name', type: String },
      description: { name: 'description', type: String },
    },
    relations: {
      category: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [
          {
            local: 'categoryId',
            foreign: 'pk',
          },
        ],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<Tax>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('ItemAdjustment', () => {
  const meta = getMeta(ItemAdjustment);
  const expectedMeta = {
    entity: ItemAdjustment,
    name: 'ItemAdjustment',
    ids: ['id' as const],
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      buyPrice: {
        name: 'buyPrice',
        type: Number,
      },
      inventoryAdjustmentId: {
        name: 'inventoryAdjustmentId',
        references: expect.anything(),
      },
      itemId: {
        name: 'itemId',
        references: expect.anything(),
      },
      number: {
        name: 'number',
        type: Number,
      },
      storehouseId: {
        name: 'storehouseId',
        references: expect.anything(),
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
    },
    relations: {
      storehouse: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'storehouseId', foreign: 'id' }],
      },
      item: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'itemId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
      inventoryAdjustment: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [
          {
            local: 'inventoryAdjustmentId',
            foreign: 'id',
          },
        ],
      },
    },
  } satisfies Partial<EntityMeta<ItemAdjustment>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('InventoryAdjustment', () => {
  const meta = getMeta(InventoryAdjustment);
  const expectedMeta = {
    entity: InventoryAdjustment,
    name: 'InventoryAdjustment',
    ids: ['id' as const],
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      description: { name: 'description', type: String },
      date: { name: 'date', type: Date },
    },
    relations: {
      itemAdjustments: {
        cardinality: '1m',
        cascade: true,
        entity: expect.anything(),
        mappedBy: 'inventoryAdjustment',
        references: [{ local: 'id', foreign: 'inventoryAdjustmentId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<InventoryAdjustment>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('MeasureUnitCategory', () => {
  const meta = getMeta(MeasureUnitCategory);
  const expectedMeta = {
    entity: MeasureUnitCategory,
    name: 'MeasureUnitCategory',
    ids: ['id' as const],
    softDelete: 'deletedAt' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      name: { name: 'name', type: String },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      deletedAt: { name: 'deletedAt', type: Number },
    },
    relations: {
      measureUnits: {
        cardinality: '1m',
        entity: expect.anything(),
        mappedBy: 'categoryId',
        references: [{ local: 'id', foreign: 'categoryId' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<MeasureUnitCategory>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('MeasureUnit', () => {
  const meta = getMeta(MeasureUnit);
  const expectedMeta = {
    entity: MeasureUnit,
    name: 'MeasureUnit',
    ids: ['id' as const],
    softDelete: 'deletedAt' as const,
    processed: true as const,
    fields: {
      id: { name: 'id', type: Number, isId: true as const },
      name: { name: 'name', type: String },
      categoryId: {
        name: 'categoryId',
        references: expect.anything(),
      },
      companyId: {
        name: 'companyId',
        references: expect.anything(),
      },
      creatorId: {
        name: 'creatorId',
        references: expect.anything(),
      },
      createdAt: { name: 'createdAt', type: Number, onInsert: expect.anything() },
      updatedAt: { name: 'updatedAt', type: Number, onUpdate: expect.anything() },
      deletedAt: { name: 'deletedAt', type: Number },
    },
    relations: {
      category: {
        cardinality: 'm1',
        cascade: 'persist',
        entity: expect.anything(),
        references: [{ local: 'categoryId', foreign: 'id' }],
      },
      company: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'companyId', foreign: 'id' }],
      },
      creator: {
        cardinality: 'm1',
        entity: expect.anything(),
        references: [{ local: 'creatorId', foreign: 'id' }],
      },
    },
  } satisfies Partial<EntityMeta<MeasureUnit>>;
  expect(meta).toMatchObject(expectedMeta);
});

it('not an @Entity', () => {
  class SomeClass {}

  expect(() => {
    getMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    id!: string;
  }

  expect(() => getMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});

it('getEntities', () => {
  const entities = getEntities();
  expect(entities.length).toBeGreaterThanOrEqual(15);
  expect(entities).toEqual(
    expect.arrayContaining([
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
    ]),
  );
});

it('no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field({ type: String })
      id!: string;
    }
  }).toThrow(
    `'SomeEntity' must have at least one id field (use @Id, defineId, or defineEntity({ fields: { ..., isId: true } }))`,
  );
});

it('no fields', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id!: string;
    }
  }).toThrow(`'SomeEntity' must have fields`);
});

it('one-to-many through a junction joins by the junction columns', () => {
  @Entity()
  class Author {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class BookAuthor {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number, references: () => Author })
    authorId?: number;
    @Field({ type: Number })
    bookId?: number;
  }

  @Entity()
  class Book {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Author, through: () => BookAuthor })
    authors?: Author[];
  }

  const meta = getMeta(Book);

  expect(meta.relations.authors!.references).toEqual([
    { local: 'bookId', foreign: 'id' },
    { local: 'authorId', foreign: 'id' },
  ]);
  // The to-one shape would have derived one reference and put an `authorsId` column on the owner.
  expect(meta.fields['authorsId']).toBeUndefined();
});

it('to-many relation with no way to join', () => {
  @Entity()
  class Chapter {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  expect(() => {
    @Entity()
    class Novel {
      @Field({ type: Number, isId: true })
      id?: number;
      // @ts-expect-error the type rejects it too; this covers the runtime guard for untyped callers
      @ManyToMany({ entity: () => Chapter })
      chapters?: Chapter[];
    }
    getMeta(Novel);
  }).toThrow(
    `'Novel.chapters' is a to-many relation with no way to join: it needs 'mappedBy' (the field on the other side), 'through' (a junction entity), or 'references' (the columns).`,
  );
});

it('mappedBy naming neither a field nor a relation', () => {
  @Entity()
  class Track {
    @Field({ type: Number, isId: true })
    id?: number;
    undeclared?: string;
  }

  @Entity()
  class Album {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Track, mappedBy: 'undeclared' })
    tracks?: Track[];
  }

  expect(() => getMeta(Album)).toThrow(
    `'Album.tracks' is mapped by 'undeclared', which is neither a field nor a relation of 'Track'.`,
  );
});

it('through entity missing a derived join column', () => {
  @Entity()
  class Colour {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class ShirtColour {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number, references: () => Colour })
    colourId?: number;
  }

  @Entity()
  class Shirt {
    @Field({ type: Number, isId: true })
    id?: number;
    @ManyToMany({ entity: () => Colour, through: () => ShirtColour })
    colours?: Colour[];
  }

  expect(() => getMeta(Shirt)).toThrow(
    `'Shirt.colours' joins through 'ShirtColour', which has no 'shirtId' field. Declare it, or name the join columns with 'references'.`,
  );
});

it('at most one softDelete field', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field({ type: String, isId: true })
      id!: string;
      @Field({ type: Number, softDelete: true })
      deletedAt?: number;
      @Field({ type: Date, softDelete: () => new Date() })
      archivedAt?: Date;
    }
  }).toThrow(`'SomeEntity' must have at most one field with 'softDelete'`);
});

it('auto-generates the FK column from a relation-only declaration', () => {
  @Entity()
  class AutoFkTarget {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    name?: string;
  }

  @Entity()
  class AutoFkOwner {
    @Id({ type: Number })
    id?: number;
    @ManyToOne({ entity: () => AutoFkTarget })
    target?: AutoFkTarget;
  }

  const meta = getMeta(AutoFkOwner);
  // auto-created FK column mirrors an explicit `@Field({ references })` column
  expect(meta.fields['targetId']).toMatchObject({ name: 'targetId', type: Number, typeFromReference: true });
  expect(meta.fields['targetId']!.references!()).toBe(AutoFkTarget);
  expect(meta.relations.target!.references).toEqual([{ local: 'targetId', foreign: 'id' }]);
});

it('auto-registers the built-in softDelete filter from @Field({ softDelete })', () => {
  const meta = getMeta(MeasureUnit);
  expect(meta.filters?.['softDelete']).toEqual({ condition: { deletedAt: null }, default: true });
});

it('registers @Filter and bulk filters', () => {
  @Filter('active', { condition: { status: 'active' }, default: false })
  @Entity({ filters: { recent: { condition: { status: 'new' } } } })
  class FilteredEntity {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    status?: string;
  }
  const meta = getMeta(FilteredEntity);
  expect(meta.filters?.['active']).toEqual({ condition: { status: 'active' }, default: false });
  expect(meta.filters?.['recent']).toEqual({ condition: { status: 'new' } });
});

it('softDelete is a reserved filter name', () => {
  expect(() => {
    @Filter('softDelete', { condition: { status: 'bogus' } })
    @Entity()
    class ReservedFilter {
      @Id({ type: Number })
      id?: number;
      @Field({ type: String })
      status?: string;
    }
    return ReservedFilter;
  }).toThrow("filter name 'softDelete' is reserved");
});

/**
 * A `security` filter is row-level security: `skip` would silently drop it whenever its condition
 * can't resolve (no context, missing tenant id), returning every row instead of none. It has to
 * fail closed, so the combination is rejected at registration rather than at query time.
 */
it('a security filter cannot opt into skipping when its condition is unresolved', () => {
  expect(() => {
    @Filter('tenant', { condition: () => undefined, security: true, onMissing: 'skip' })
    @Entity()
    class SkippableSecurityFilter {
      @Id({ type: Number })
      id?: number;
    }
    return SkippableSecurityFilter;
  }).toThrow("security filter 'tenant' cannot use onMissing: 'skip' (it must fail closed)");
});

/** The last `@Id` wins, and the one it replaces stops being a field altogether. */
it('a second @Id makes the primary key composite', () => {
  @Entity()
  class Membership {
    @Id({ type: Number })
    userId?: number;
    @Id({ type: Number })
    groupId?: number;
    @Field({ type: String })
    role?: string;
  }

  const meta = getMeta(Membership);
  expect(meta.ids).toEqual(['userId', 'groupId']);
  expect(getKeys(meta.fields)).toEqual(['userId', 'groupId', 'role']);
  // Membership is the field's own flag, never a lookup in `ids`.
  expect(meta.fields.userId?.isId).toBe(true);
  expect(meta.fields.role?.isId).toBeUndefined();
});

/**
 * Both sides of a junction contribute one column per key, in their own order. The inverse side swaps
 * the two groups whole; reversing the array would pair a composite's columns crosswise.
 */
it('a junction pairs every key of both sides, and the inverse side swaps the groups', () => {
  @Entity()
  class Enrolment {
    @Id({ type: Number }) studentId?: number;
    @Id({ type: String }) courseId?: string;
    @ManyToMany({ entity: () => Badge, through: () => EnrolmentBadge })
    badges?: Badge[];
  }
  @Entity()
  class Badge {
    @Id({ type: Number }) id?: number;
    @ManyToMany({ entity: () => Enrolment, mappedBy: (it) => it.badges })
    enrolments?: Enrolment[];
  }
  @Entity()
  class EnrolmentBadge {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) enrolmentStudentId?: number;
    @Field({ type: String }) enrolmentCourseId?: string;
    @Field({ type: Number }) badgeId?: number;
  }

  expect(getMeta(Enrolment).relations.badges?.references).toEqual([
    { local: 'enrolmentStudentId', foreign: 'studentId' },
    { local: 'enrolmentCourseId', foreign: 'courseId' },
    { local: 'badgeId', foreign: 'id' },
  ]);
  expect(getMeta(Badge).relations.enrolments?.references).toEqual([
    { local: 'badgeId', foreign: 'id' },
    { local: 'enrolmentStudentId', foreign: 'studentId' },
    { local: 'enrolmentCourseId', foreign: 'courseId' },
  ]);
});

/** `mappedBy` names one column, which one key fits: guessing which of several would join wrong rows. */
it('refuses an inverse relation mapped by a field when the key is composite', () => {
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) enrolmentStudentId?: number;
  }
  @Entity()
  class Enrolment {
    @Id({ type: Number }) studentId?: number;
    @Id({ type: String }) courseId?: string;
    @OneToMany({ entity: () => Note, mappedBy: (it) => it.enrolmentStudentId })
    notes?: Note[];
  }

  const error = getError(() => getMeta(Enrolment));
  expect(error).toContain(`'Enrolment.notes' is mapped by 'Note.enrolmentStudentId', one column`);
  expect(error).toContain('composite (studentId, courseId)');
});

/** The pair reads the same way round as every other: the parent's own key on the left. */
it('pairs an inverse relation mapped by a field from the parent side', () => {
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) ownerId?: number;
  }
  @Entity()
  class Owner {
    @Id({ type: Number }) id?: number;
    @OneToMany({ entity: () => Note, mappedBy: (it) => it.ownerId })
    notes?: Note[];
  }

  expect(getMeta(Owner).relations.notes?.references).toEqual([{ local: 'id', foreign: 'ownerId' }]);
});

/** The message a registration error carries, for a test that pins what it says and not how. */
function getError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a registration error');
}

/** One column cannot reference a two-column key; the relation decorators make one column per key. */
it('refuses a plain foreign key pointing at a composite key', () => {
  @Entity()
  class Enrolment {
    @Id({ type: Number }) studentId?: number;
    @Id({ type: String }) courseId?: string;
  }
  @Entity()
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ references: () => Enrolment }) enrolmentStudentId?: number;
  }

  // The column, the key it cannot reach, and the decorator that can: the rest is wording.
  const error = getError(() => getMeta(Note));
  expect(error).toContain(`'Note.enrolmentStudentId'`);
  expect(error).toContain('composite (studentId, courseId)');
  expect(error).toContain('@ManyToOne({ entity: () => Enrolment })');
});

/** Every column of the parent's key, or the ones it did not replace would widen the child's. */
it('a subclass declaring its own key drops every key of a composite parent', () => {
  @Entity()
  class Pair {
    @Id({ type: Number }) left?: number;
    @Id({ type: Number }) right?: number;
    @Field({ type: String }) label?: string;
  }
  @Entity()
  class Single extends Pair {
    @Id({ type: Number }) id?: number;
  }

  const meta = getMeta(Single);
  expect(meta.ids).toEqual(['id']);
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'label']);
});

it('subclass declaring the only @Id inherits the parent fields', () => {
  class IdlessBase {
    @Field({ type: String })
    name?: string;
  }

  @Entity()
  class IdentifiedChild extends IdlessBase {
    @Id({ type: Number })
    id?: number;
  }

  const meta = getMeta(IdentifiedChild);
  expect(meta.ids[0]).toBe('id');
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'name']);
});

it('subclass inherits parent softDelete field key and filters', () => {
  @Filter('active', { condition: { status: 'active' }, default: false })
  @Entity()
  class SoftBase {
    @Id({ type: Number })
    id?: number;
    @Field({ type: String })
    status?: string;
    @Field({ type: Date, softDelete: true })
    deletedAt?: Date;
  }

  @Entity()
  class SoftChild extends SoftBase {
    @Field({ type: String })
    name?: string;
  }

  const meta = getMeta(SoftChild);
  expect(meta.softDelete).toBe('deletedAt');
  expect(meta.filters?.['softDelete']).toEqual({ condition: { deletedAt: null }, default: true });
  expect(meta.filters?.['active']).toEqual({ condition: { status: 'active' }, default: false });
});

it('foreign-key column gets its relation without anyone declaring one', () => {
  @Entity()
  class Warehouse {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class Pallet {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ references: () => Warehouse })
    warehouseId?: number;
    @Field({ type: String })
    label?: string;
  }

  const meta = getMeta(Pallet);

  expect(meta.relations['warehouse']!.cardinality).toBe('m1');
  expect(meta.relations['warehouse']!.entity()).toBe(Warehouse);
  expect(meta.relations['warehouse']!.references).toEqual([{ local: 'warehouseId', foreign: 'id' }]);
  expect(meta.relations['label']).toBe(undefined);
});

it('a junction keeps the relations it declares itself', () => {
  @Entity()
  class Screening {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class Note {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number })
    filmScreeningId?: number;
  }

  @Entity()
  class FilmScreening {
    @Field({ type: Number, isId: true })
    id?: number;
    @ManyToOne({ entity: () => Film, cascade: 'delete' })
    film?: Film;
    @Field({ references: () => Screening })
    screeningId?: number;
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.filmScreeningId })
    notes?: Note[];
  }

  @Entity()
  class Film {
    @Field({ type: Number, isId: true })
    id?: number;
    @ManyToMany({ entity: () => Screening, through: () => FilmScreening })
    screenings?: Screening[];
  }

  expect(getMeta(Film).relations.screenings!.references).toEqual([
    { local: 'filmId', foreign: 'id' },
    { local: 'screeningId', foreign: 'id' },
  ]);
  const junction = getMeta(FilmScreening);
  expect(junction.relations.film!.cascade).toBe('delete');
  expect(junction.relations.notes!.references).toEqual([{ local: 'id', foreign: 'filmScreeningId' }]);
  expect(junction.relations['screening']!.references).toEqual([{ local: 'screeningId', foreign: 'id' }]);
});

it('mappedBy naming an inverse side, so neither side owns the foreign key', () => {
  @Entity()
  class Passport {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Traveller, mappedBy: (traveller) => traveller.passports })
    travellers?: Traveller[];
  }

  @Entity()
  class Traveller {
    @Field({ type: Number, isId: true })
    id?: number;
    @OneToMany({ entity: () => Passport, mappedBy: (passport) => passport.travellers })
    passports?: Passport[];
  }

  // Resolving either side resolves the other first, so the pair is reported from the inner one.
  expect(() => getMeta(Traveller)).toThrow(
    `'Passport.travellers' is mapped by 'Traveller.passports', an inverse side too, so neither owns the foreign key.`,
  );
});

it('hand-written references are still checked against the junction', () => {
  @Entity()
  class Seat {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class CoachSeat {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ references: () => Seat })
    seatId?: number;
  }

  @Entity()
  class Coach {
    @Field({ type: Number, isId: true })
    id?: number;
    @ManyToMany({
      entity: () => Seat,
      through: () => CoachSeat,
      references: [
        { local: 'coachRef', foreign: 'id' },
        { local: 'seatId', foreign: 'id' },
      ],
    })
    seats?: Seat[];
  }

  expect(() => getMeta(Coach)).toThrow(
    `'Coach.seats' joins through 'CoachSeat', which has no 'coachRef' field. Declare it, or name the join columns with 'references'.`,
  );
});

it('a foreign-key column not named after the key it points at stays a plain column', () => {
  @Entity()
  class Airport {
    @Field({ type: Number, isId: true })
    id?: number;
  }

  @Entity()
  class Flight {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ references: () => Airport })
    origin?: number;
  }

  const meta = getMeta(Flight);

  expect(getKeys(meta.relations)).toEqual([]);
  expect(meta.fields.origin!.references!()).toBe(Airport);
});
