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
import {
  type EntityMeta,
  type IdKey,
  type KeyMap,
  SQL_FN,
  RelationAggregate,
  idKey,
  versionKey,
} from '../../type/index.js';
import { getKeys, sql } from '../../util/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { AfterLoad, BeforeInsert, Computed, Entity, f, Field, ManyToMany, ManyToOne, OneToMany } from '../index.js';
import {
  assertSoleId,
  defineEntity,
  fieldOf,
  foreignKeysOf,
  getEntities,
  getMeta,
  idOf,
  keyOf,
  relationOf,
} from './definition.js';

it('should name an entity that declares no primary key', () => {
  class Keyless {
    @Field(f.string().nullable()) name?: string | null;
  }
  @Entity()
  class Keyed extends Keyless {
    @Field(f.number().id()) id?: number;
  }
  expect(getMeta(Keyed).ids).toEqual(['id']);
  expect(() => assertSoleId(getMeta(Keyless), 'a key lookup')).toThrow(
    "'Keyless' has no primary key, which a key lookup needs.",
  );
});

it('should name the columns of a composite key, and name its row by every one', () => {
  @Entity()
  class Seat {
    [idKey]?: 'row' | 'number';
    @Field(f.string().id()) row?: string;
    @Field(f.number().id()) number?: number;
    @Field(f.string().nullable()) holder?: string | null;
  }
  const meta = getMeta(Seat);
  expect(() => assertSoleId(meta, 'a key lookup')).toThrow(
    "'Seat' has a composite primary key (row, number), which a key lookup does not support.",
  );
  expect(idOf(meta, { row: 'F', number: 12, holder: 'Ada' })).toEqual({ row: 'F', number: 12 });
});

it('should name the field it reads, and refuse one the entity does not declare', () => {
  const meta = getMeta(User);
  expect(fieldOf(meta, 'name')).toBe(meta.fields.name);
  // Outside the types, which name a field; the throw is for a key that reached it untyped.
  expect(() => fieldOf(meta, 'nope')).toThrow("'User' has no field 'nope'");
  expect(() => fieldOf(meta, 'nope')).toThrow(UqlUsageError);
});

it('should name the relation it reads, and refuse one the entity does not declare', () => {
  const meta = getMeta(User);
  expect(relationOf(meta, 'company')).toBe(meta.relations.company);
  // Outside the types, which name a relation; the throw is for a key that reached it untyped.
  // @ts-expect-error: `name` is a field
  expect(() => relationOf(meta, 'name')).toThrow("'User' has no relation 'name'");
});

it('should keep a check constraint as authored, for the schema build to render', () => {
  const checks = [{ name: 'quantity_positive', where: sql`quantity > 0` }, { where: sql`quantity < 1000` }];
  @Entity({ checks: (_, check) => checks.map(({ where, name }) => check(where, name)) })
  class Stocked {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) quantity?: number | null;
  }
  expect(getMeta(Stocked).checks).toEqual(checks);
});

it('should refuse a field option the column type does not take', () => {
  expect(() => {
    @Entity()
    class Conflicted {
      @Field(f.number().id()) id?: number;
      // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
      @Field(f.number().nullable().length(10)) amount?: number | null;
    }
    return Conflicted;
  }).toThrow("'Conflicted.amount' cannot use 'length': it applies to a string column, not to a numeric one.");
});

it('should refuse a vector field measuring by another metric than its index ranks by', () => {
  expect(() => {
    @Entity({ indexes: (twoMetrics, index) => [index([twoMetrics.embedding], { type: 'hnsw', distance: 'inner' })] })
    class TwoMetrics {
      @Field(f.number().id()) id?: number;
      @Field(f.vector(3).nullable().distance('l2')) embedding?: number[] | null;
    }
    return TwoMetrics;
  }).toThrow("'TwoMetrics.embedding' measures by 'l2', but its vector index ranks by 'inner': name one metric");
});

/** A foreign key's kind is checked against the key it references, read off registrations alone. */
it('should check a chained foreign key without resolving the entity at its end', () => {
  const Owner = defineEntity({ name: 'Owner', fields: { id: f.number().id() } });
  const Root = defineEntity({
    name: 'Root',
    fields: { id: f.number().id(), ownerId: f.number().nullable() },
  }).relations((rel) => ({
    // @ts-expect-error a cascade only resolving refuses at run time, standing for any mistake it finds
    owner: () => rel.manyToOne(Owner, { references: (root) => root.ownerId, cascade: 'delete' }),
  }));
  // Its key takes its type from Root's, which only a column-level foreign key can say: a decorated one.
  @Entity()
  class Shared {
    @Field(f.references(() => Root).id()) id?: number;
  }
  const Leaf = defineEntity({
    name: 'Leaf',
    fields: { id: f.number().id(), sharedId: f.number().nullable() },
  }).relations((rel) => ({ shared: () => rel.manyToOne(Shared, { references: (leaf) => leaf.sharedId }) }));

  expect(getMeta(Leaf).fields.sharedId?.type).toBe(Number);
  expect(() => getMeta(Root)).toThrow("'Root.owner' holds the key");
});

/** Read on every query that names no fields, so worked out once, when the entity is resolved. */
it('should keep the fields a read answers with by default, a relation aggregate left out', () => {
  const Shelf = defineEntity({
    name: 'Shelf',
    fields: { id: f.number().id(), label: f.string().nullable() },
  }).relations(
    (rel) => ({ books: () => rel.oneToMany(Volume, { mappedBy: (volume) => volume.shelf }) }),
    (shelf) => ({ bookCount: () => shelf.books.count() }),
  );
  const Volume = defineEntity({
    name: 'Volume',
    fields: { id: f.number().id(), shelfId: f.number().nullable() },
  }).relations((rel) => ({ shelf: () => rel.manyToOne(Shelf, { references: (volume) => volume.shelfId }) }));

  expect(getMeta(Shelf).readKeys).toEqual(['id', 'label']);
  expect(getMeta(Volume).readKeys).toEqual(['id', 'shelfId']);
});

it('should refuse a dotted entity name, pointing at the schema option', () => {
  expect(() => {
    @Entity({ name: 'crm.users' })
    class Dotted {
      @Field(f.number().id()) id?: number;
    }
    return Dotted;
  }).toThrow("'Dotted' has a dotted name 'crm.users'. Name the schema separately as { schema: 'crm', name: 'users' }.");
});

it('should keep the columns an inverse side names itself', () => {
  @Entity()
  class Shelf {
    @Field(f.number().id()) id?: number;
    // @ts-expect-error `mappedBy` derives the columns, so the types take one or the other; plain JavaScript reaches here
    @OneToMany({
      entity: () => Book,
      mappedBy: (book) => book.shelf,
      references: (shelf, book) => [{ local: shelf.id, foreign: book.shelfRef }],
    })
    books?: Book[];
  }
  @Entity()
  class Book {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Shelf).nullable()) shelfRef?: number | null;
    @ManyToOne({ entity: () => Shelf, references: (book, shelf) => [{ local: book.shelfRef, foreign: shelf.id }] })
    shelf?: Shelf;
  }
  expect(getMeta(Shelf).relations.books?.references).toEqual([{ local: 'id', foreign: 'shelfRef' }]);
});

it('should keep a foreign key column a column, with no relation it did not declare', () => {
  @Entity()
  class Warehouse {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Pallet {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Warehouse).nullable()) warehouseId?: number | null;
  }
  const meta = getMeta(Pallet);
  expect(meta.relations).toEqual({});
  expect(meta.fields.warehouseId?.references?.()).toBe(Warehouse);
});

it('should take a junction column as the one referencing its side, whatever either is called', () => {
  @Entity()
  class Course {
    @Field(f.number().id().name('course_pk')) id?: number;
    @ManyToMany({ entity: () => Student, through: () => Enrolment }) students?: Student[];
  }
  @Entity()
  class Student {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Enrolment {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Course).nullable()) course?: number | null;
    @Field(f.references(() => Student).nullable()) learner?: number | null;
  }
  expect(getMeta(Course).relations.students?.references).toEqual([
    { local: 'course', foreign: 'id' },
    { local: 'learner', foreign: 'id' },
  ]);
});

it('should register the User metadata', () => {
  const meta = getMeta(User);

  expect(meta.fields.companyId?.references?.()).toBe(Company);
  expect(meta.relations.company?.entity?.()).toBe(Company);
  expect(meta.relations.company?.references).toEqual([{ local: 'companyId', foreign: 'id' }]);

  expect(meta.fields.creatorId?.references?.()).toBe(User);
  expect(meta.relations.creator?.entity?.()).toBe(User);
  expect(meta.relations.creator?.references).toEqual([{ local: 'creatorId', foreign: 'id' }]);

  const expectedMeta = {
    entity: User,
    name: 'User',
    ids: ['id'] as const,
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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

it('should register the Profile metadata', () => {
  const meta = getMeta(Profile);
  const expectedMeta = {
    entity: Profile,
    name: 'user_profile',
    ids: ['pk' as IdKey<Profile>],
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

it('should register the Item metadata', () => {
  const meta = getMeta(Item);
  const expectedMeta = {
    entity: Item,
    name: 'Item',
    ids: ['id' as const],
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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
        // The aggregate is what types the field, so it declares none of its own.
        computed: expect.any(RelationAggregate),
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

it('should register the Tag metadata', () => {
  const meta = getMeta(Tag);
  const expectedMeta = {
    entity: Tag,
    ids: ['id' as const],
    name: 'Tag',
    fields: {
      id: {
        isId: true as const,
        name: 'id',
        type: String,
        onInsert: expect.anything(),
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
        computed: expect.objectContaining({
          [SQL_FN]: expect.any(Function),
          spec: { relation: 'items', op: '$count' },
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

it('should register the ItemTag metadata', () => {
  const meta = getMeta(ItemTag);
  const expectedMeta = {
    entity: ItemTag,
    name: 'ItemTag',
    ids: ['id' as const],
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
      itemId: {
        name: 'itemId',
        references: expect.anything(),
      },
      tagId: {
        name: 'tagId',
        references: expect.anything(),
      },
    },
  } satisfies Partial<EntityMeta<ItemTag>>;
  expect(meta).toMatchObject(expectedMeta);
  expect(meta.relations).toEqual({});
});

it('should register the TaxCategory metadata', () => {
  const meta = getMeta(TaxCategory);
  const expectedMeta = {
    entity: TaxCategory,
    name: 'TaxCategory',
    ids: ['pk' as const],
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

it('should register the Tax metadata', () => {
  const meta = getMeta(Tax);
  const expectedMeta = {
    entity: Tax,
    name: 'Tax',
    ids: ['id' as const],
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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

it('should register the ItemAdjustment metadata', () => {
  const meta = getMeta(ItemAdjustment);
  const expectedMeta = {
    entity: ItemAdjustment,
    name: 'ItemAdjustment',
    ids: ['id' as const],
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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

it('should register the InventoryAdjustment metadata', () => {
  const meta = getMeta(InventoryAdjustment);
  const expectedMeta = {
    entity: InventoryAdjustment,
    name: 'InventoryAdjustment',
    ids: ['id' as const],
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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

it('should register the MeasureUnitCategory metadata', () => {
  const meta = getMeta(MeasureUnitCategory);
  const expectedMeta = {
    entity: MeasureUnitCategory,
    name: 'MeasureUnitCategory',
    ids: ['id' as const],
    softDelete: 'deletedAt' as const,
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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

it('should register the MeasureUnit metadata', () => {
  const meta = getMeta(MeasureUnit);
  const expectedMeta = {
    entity: MeasureUnit,
    name: 'MeasureUnit',
    ids: ['id' as const],
    softDelete: 'deletedAt' as const,
    fields: {
      id: { name: 'id', type: String, isId: true as const, onInsert: expect.anything() },
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

it('should refuse metadata for a class that is no entity', () => {
  class SomeClass {}

  expect(() => {
    getMeta(SomeClass);
  }).toThrow(`'SomeClass' is not an entity`);

  class AnotherClass {
    id!: string;
  }

  expect(() => getMeta(AnotherClass)).toThrow(`'AnotherClass' is not an entity`);
});

it('should list every registered entity', () => {
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

it('should refuse an entity with no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field(f.string().nullable())
      id!: string | null;
    }
    return SomeEntity;
  }).toThrow(`'SomeEntity' must have at least one id field (declare one with 'id()', as in 'f.number().id()')`);
});

it('should refuse an entity with no fields', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id!: string;
    }
    return SomeEntity;
  }).toThrow(`'SomeEntity' must have fields`);
});

it("should join a one-to-many through a junction by the junction's columns", () => {
  @Entity()
  class Author {
    @Field(f.number().id())
    id?: number;
  }

  @Entity()
  class BookAuthor {
    @Field(f.number().id())
    id?: number;
    @Field(
      f
        .number()
        .nullable()
        .references(() => Author),
    )
    authorId?: number | null;
    @Field(
      f
        .number()
        .nullable()
        .references(() => Book),
    )
    bookId?: number | null;
  }

  @Entity()
  class Book {
    @Field(f.number().id())
    id?: number;
    @OneToMany({ entity: () => Author, through: () => BookAuthor })
    authors?: Author[];
  }

  const meta = getMeta(Book);

  expect(meta.relations.authors?.references).toEqual([
    { local: 'bookId', foreign: 'id' },
    { local: 'authorId', foreign: 'id' },
  ]);
});

it('should refuse a one-to-many whose target holds no relation back', () => {
  @Entity()
  class Page {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Diary {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Page }) pages?: Page[];
  }

  expect(() => getMeta(Diary)).toThrow("'Diary.pages' is a to-many relation with no way to join");
});

it('should refuse a to-many relation with no way to join', () => {
  @Entity()
  class Chapter {
    @Field(f.number().id())
    id?: number;
  }

  expect(() => {
    @Entity()
    class Novel {
      @Field(f.number().id())
      id?: number;
      // @ts-expect-error the type rejects it too; this covers the runtime guard for untyped callers
      @ManyToMany({ entity: () => Chapter })
      chapters?: Chapter[];
    }
    getMeta(Novel);
  }).toThrow(
    `'Novel.chapters' is a to-many relation with no way to join: it needs 'mappedBy' (the member on the other side), 'through' (a junction entity), or 'references' (the columns).`,
  );
});

it('should refuse a mappedBy naming neither a field nor a relation', () => {
  @Entity()
  class Track {
    @Field(f.number().id())
    id?: number;
    undeclared?: string;
  }

  @Entity()
  class Album {
    @Field(f.number().id())
    id?: number;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @OneToMany({ entity: () => Track, mappedBy: (track) => track.undeclared })
    tracks?: Track[];
  }

  expect(() => getMeta(Album)).toThrow(
    `'Album.tracks' is mapped by 'undeclared', which is neither a field nor a relation of 'Track'.`,
  );
});

it('should say which column to declare for a junction referencing no side', () => {
  @Entity()
  class Colour {
    @Field(f.number().id())
    id?: number;
  }

  @Entity()
  class ShirtColour {
    @Field(f.number().id())
    id?: number;
    @Field(
      f
        .number()
        .nullable()
        .references(() => Colour),
    )
    colourId?: number | null;
  }

  @Entity()
  class Shirt {
    @Field(f.number().id())
    id?: number;
    @ManyToMany({ entity: () => Colour, through: () => ShirtColour })
    colours?: Colour[];
  }

  expect(() => getMeta(Shirt)).toThrow(
    `'Shirt.colours' joins through 'ShirtColour', which has no column referencing 'Shirt.id': declare 'f.references(() => Shirt)'.`,
  );
});

it('should say to pair a column per key for a junction referencing no side of a composite key', () => {
  @Entity()
  class Size {
    @Field(f.number().id()) id?: number;
  }

  @Entity()
  class Fit {
    @Field(f.number().id()) id?: number;
    @Field(
      f
        .number()
        .nullable()
        .references(() => Size),
    )
    sizeId?: number | null;
  }

  @Entity()
  class Garment {
    [idKey]?: 'brand' | 'code';
    @Field(f.string().id()) brand?: string;
    @Field(f.string().id()) code?: string;
    @ManyToMany({ entity: () => Size, through: () => Fit }) sizes?: Size[];
  }

  expect(() => getMeta(Garment)).toThrow(
    `'Garment.sizes' joins through 'Fit', which has no column referencing 'Garment.brand': declare a column per key, paired in a '@ManyToOne' to 'Garment'.`,
  );
});

it('should refuse a junction where two columns reference the same key', () => {
  @Entity()
  class Person {
    @Field(f.number().id()) id?: number;
    @ManyToMany({ entity: () => Person, through: () => Friendship }) friends?: Person[];
  }
  @Entity()
  class Friendship {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Person).nullable()) personId?: number | null;
    @Field(f.references(() => Person).nullable()) friendId?: number | null;
  }

  expect(() => getMeta(Person)).toThrow(
    `'Person.friends' joins through 'Friendship', where 'personId' and 'friendId' each reference 'Person.id': a junction needs exactly one column per key of each side.`,
  );
});

it('should resolve a junction read first, even with an inverse side leading back through it', () => {
  @Entity()
  class Film {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Screening {
    @Field(f.number().id()) id?: number;
    // Ahead of the junction's own foreign key, and leading back through the junction.
    @OneToMany({ entity: () => Review, mappedBy: (review) => review.screening }) reviews?: Review[];
    @Field(f.references(() => Film).nullable()) filmId?: number | null;
    @ManyToOne({ entity: () => Film, references: (screening) => screening.filmId }) film?: Film;
    @Field(f.references(() => Review).nullable()) reviewId?: number | null;
  }
  @Entity()
  class Review {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Screening).nullable()) screeningId?: number | null;
    @ManyToOne({ entity: () => Screening, references: (review) => review.screeningId }) screening?: Screening;
    @ManyToMany({ entity: () => Film, through: () => Screening }) films?: Film[];
  }

  expect(getMeta(Screening).relations.reviews?.references).toEqual([{ local: 'id', foreign: 'screeningId' }]);
  expect(getMeta(Review).relations.films?.references).toEqual([
    { local: 'reviewId', foreign: 'id' },
    { local: 'filmId', foreign: 'id' },
  ]);
});

it('should resolve an inverse side through a junction whichever side is read first', () => {
  @Entity()
  class Genre {
    @Field(f.number().id()) id?: number;
    @ManyToMany({ entity: () => Album, mappedBy: (album) => album.genres }) albums?: Album[];
    @Field(f.references(() => Album).nullable()) featuredId?: number | null;
    @ManyToOne({ entity: () => Album, references: (genre) => genre.featuredId }) featured?: Album;
  }
  @Entity()
  class Album {
    @Field(f.number().id()) id?: number;
    // Ahead of the relation `Genre.albums` is the inverse of, and leading to `Genre` first.
    @OneToMany({ entity: () => Genre, mappedBy: (genre) => genre.featured }) featuredBy?: Genre[];
    @ManyToMany({ entity: () => Genre, through: () => AlbumGenre }) genres?: Genre[];
  }
  @Entity()
  class AlbumGenre {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Album).nullable()) albumId?: number | null;
    @Field(f.references(() => Genre).nullable()) genreId?: number | null;
  }

  expect(getMeta(Album).relations.featuredBy?.references).toEqual([{ local: 'id', foreign: 'featuredId' }]);
  expect(getMeta(Genre).relations.albums?.references).toEqual([
    { local: 'genreId', foreign: 'id' },
    { local: 'albumId', foreign: 'id' },
  ]);
});

it('should refuse a second softDelete field', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Field(f.string().id())
      id!: string;
      @Field(f.number().nullable().softDelete())
      deletedAt?: number | null;
      @Field(
        f
          .date()
          .nullable()
          .softDelete(() => new Date()),
      )
      archivedAt?: Date | null;
    }
    return SomeEntity;
  }).toThrow(`'SomeEntity' must have at most one field with 'softDelete'`);
});

it('should refuse a second version field', () => {
  expect(() => {
    @Entity()
    class Ledger {
      [versionKey]?: 'version' | 'revision';
      @Field(f.number().id()) id?: number;
      @Field(f.version()) version?: number;
      @Field(f.version()) revision?: number;
    }
    return Ledger;
  }).toThrow(`'Ledger' must have at most one field with 'version'`);
});

it('should join a to-one on the foreign key its references name, whatever either is called', () => {
  @Entity()
  class Author {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Essay, mappedBy: (essay) => essay.author }) essays?: Essay[];
  }
  @Entity()
  class Essay {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Author).nullable()) writtenById?: number | null;
    @ManyToOne({ entity: () => Author, references: (essay) => essay.writtenById }) author?: Author;
  }

  expect(getMeta(Author).relations.essays?.references).toEqual([{ local: 'id', foreign: 'writtenById' }]);
  expect(getMeta(Essay).relations.author?.references).toEqual([{ local: 'writtenById', foreign: 'id' }]);
  expect(getKeys(getMeta(Essay).fields)).toEqual(['id', 'writtenById']);
});

it('should refuse a to-one naming no foreign key, on every read rather than handing back a half-resolved one', () => {
  @Entity()
  class Quay {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Barge {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) quayId?: number | null;
    @ManyToOne({ entity: () => Quay }) quay?: Quay;
  }

  const refusal =
    "'Barge.quay' needs 'references', the foreign key column it joins by, or 'mappedBy', the member on the " +
    'other side holding it.';
  expect(() => getMeta(Barge)).toThrow(refusal);
  expect(() => getMeta(Barge)).toThrow(refusal);
});

it('should refuse a join on a member that is not a column of its entity', () => {
  @Entity()
  class Pier {
    @Field(f.number().id()) id?: number;
    @Computed((row) =>
      f
        .number()
        .nullable()
        .as(sql`1`),
    )
    berthCount?: number | null;
  }
  @Entity()
  class Tug {
    @Field(f.number().id()) id?: number;
    pierId?: number;
    @ManyToOne({ entity: () => Pier, references: (tug) => tug.pierId }) pier?: Pier;
  }
  @Entity()
  class Yacht {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) pierId?: number | null;
    @ManyToOne({
      entity: () => Pier,
      references: (yacht, pier) => [{ local: yacht.pierId, foreign: pier.berthCount }],
    })
    pier?: Pier;
  }

  expect(() => getMeta(Tug)).toThrow("'Tug.pier' joins 'Tug.pierId', which is not a column: declare it with '@Field'.");
  expect(() => getMeta(Yacht)).toThrow(
    "'Yacht.pier' joins 'Pier.berthCount', which is not a column: declare it with '@Field'.",
  );
});

it('should refuse a to-one whose foreign key references another entity', () => {
  @Entity()
  class Harbour {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Marina {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Ferry {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Marina).nullable()) harbourId?: number | null;
    @ManyToOne({ entity: () => Harbour, references: (ferry) => ferry.harbourId }) harbour?: Harbour;
  }

  expect(() => getMeta(Ferry)).toThrow(
    "'Ferry.harbour' joins 'Ferry.harbourId', a foreign key to 'Marina', not to 'Harbour'.",
  );
});

it('should refuse references naming one column for a composite key, which needs a column per key', () => {
  @Entity()
  class Locker {
    [idKey]?: 'row' | 'slot';
    @Field(f.string().id()) row?: string;
    @Field(f.number().id()) slot?: number;
  }
  @Entity()
  class Rental {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) lockerRef?: string | null;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @ManyToOne({ entity: () => Locker, references: (rental) => rental.lockerRef }) locker?: Locker;
  }

  expect(() => getMeta(Rental)).toThrow(
    "'Rental.locker' names one column, 'lockerRef', which only a to-one holding a foreign key to a one-column key " +
      'can: pair the columns, [{ local, foreign }].',
  );
});

/** Types keep one column to the side of a to-one holding the key; this is the guard for a caller they cannot see. */
it('should refuse references naming one column on a relation that holds no foreign key', () => {
  @Entity()
  class Dock {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Ship {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) dockId?: number | null;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @OneToMany({ entity: () => Dock, references: (ship) => ship.dockId }) docks?: Dock[];
  }

  expect(() => getMeta(Ship)).toThrow(
    "'Ship.docks' names one column, 'dockId', which only a to-one holding a foreign key to a one-column key " +
      'can: pair the columns, [{ local, foreign }].',
  );
});

it('should join a relation a base class declares on its foreign key in every entity extending it', () => {
  @Entity()
  class Region {
    @Field(f.number().id()) id?: number;
  }
  abstract class Regional {
    @Field(f.references(() => Region).nullable()) regionId?: number | null;
    @ManyToOne({ entity: () => Region, references: (regional) => regional.regionId }) region?: Region;
  }
  @Entity()
  class Office extends Regional {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Depot extends Regional {
    @Field(f.number().id()) id?: number;
  }

  expect(getMeta(Office).relations.region?.references).toEqual([{ local: 'regionId', foreign: 'id' }]);
  expect(getMeta(Depot).relations.region?.references).toEqual([{ local: 'regionId', foreign: 'id' }]);
});

it('should register the built-in softDelete filter from @Field({ softDelete })', () => {
  const meta = getMeta(MeasureUnit);
  expect(meta.filters?.['softDelete']).toEqual({ where: { deletedAt: null }, default: true });
});

it('should register @Filter and bulk filters', () => {
  @Entity({
    filters: { recent: { where: { status: 'new' } }, active: { where: { status: 'active' }, default: false } },
  })
  class FilteredEntity {
    @Field(f.number().id())
    id?: number;
    @Field(f.string().nullable())
    status?: string | null;
  }
  const meta = getMeta(FilteredEntity);
  expect(meta.filters?.['active']).toEqual({ where: { status: 'active' }, default: false });
  expect(meta.filters?.['recent']).toEqual({ where: { status: 'new' } });
});

it('should refuse softDelete as a filter name', () => {
  expect(() => {
    @Entity({
      filters: {
        // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
        softDelete: { where: { status: 'bogus' } },
      },
    })
    class ReservedFilter {
      @Field(f.number().id())
      id?: number;
      @Field(f.string().nullable())
      status?: string | null;
    }
    return ReservedFilter;
  }).toThrow("filter name 'softDelete' is reserved");
});

/**
 * A `security` filter is row-level security: `skip` would silently drop it whenever its condition
 * can't resolve (no context, missing tenant id), returning every row instead of none. It has to
 * fail closed, so the combination is rejected at registration rather than at query time.
 */
it('should refuse a security filter that skips when its condition is unresolved', () => {
  expect(() => {
    @Entity({
      filters: {
        // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
        tenant: { where: () => undefined, security: true, onMissing: 'skip' },
      },
    })
    class SkippableSecurityFilter {
      @Field(f.number().id())
      id?: number;
    }
    return SkippableSecurityFilter;
  }).toThrow("security filter 'tenant' cannot use onMissing: 'skip' (it must fail closed)");
});

/** The last `@Id` wins, and the one it replaces stops being a field altogether. */
it('should make the primary key composite on a second @Id', () => {
  @Entity()
  class Membership {
    [idKey]?: 'userId' | 'groupId';
    @Field(f.number().id())
    userId?: number;
    @Field(f.number().id())
    groupId?: number;
    @Field(f.string().nullable())
    role?: string | null;
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
it('should pair every key of both sides in a junction, the inverse side swapping the groups', () => {
  @Entity()
  class Enrolment {
    [idKey]?: 'studentId' | 'courseId';
    @Field(f.number().id()) studentId?: number;
    @Field(f.string().id()) courseId?: string;
    @ManyToMany({ entity: () => Badge, through: () => EnrolmentBadge })
    badges?: Badge[];
  }
  @Entity()
  class Badge {
    @Field(f.number().id()) id?: number;
    @ManyToMany({ entity: () => Enrolment, mappedBy: (enrolment) => enrolment.badges })
    enrolments?: Enrolment[];
  }
  @Entity()
  class EnrolmentBadge {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) enrolmentStudentId?: number | null;
    @Field(f.string().nullable()) enrolmentCourseId?: string | null;
    @ManyToOne({
      entity: () => Enrolment,
      references: (enrolmentBadge, enrolment) => [
        { local: enrolmentBadge.enrolmentStudentId, foreign: enrolment.studentId },
        { local: enrolmentBadge.enrolmentCourseId, foreign: enrolment.courseId },
      ],
    })
    enrolment?: Enrolment;
    @Field(f.references(() => Badge).nullable()) badgeId?: number | null;
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
it('should refuse an inverse relation mapped by a field when the key is composite', () => {
  @Entity()
  class Note {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) enrolmentStudentId?: number | null;
  }
  @Entity()
  class Enrolment {
    [idKey]?: 'studentId' | 'courseId';
    @Field(f.number().id()) studentId?: number;
    @Field(f.string().id()) courseId?: string;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.enrolmentStudentId })
    notes?: Note[];
  }

  const error = getError(() => getMeta(Enrolment));
  expect(error).toContain(`'Enrolment.notes' is mapped by 'Note.enrolmentStudentId', one column`);
  expect(error).toContain('composite (studentId, courseId)');
});

/** The pair reads the same way round as every other: the parent's own key on the left. */
it('should pair an inverse relation mapped by a field from the parent side', () => {
  @Entity()
  class Note {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) ownerId?: number | null;
  }
  @Entity()
  class Owner {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.ownerId })
    notes?: Note[];
  }

  expect(getMeta(Owner).relations.notes?.references).toEqual([{ local: 'id', foreign: 'ownerId' }]);
});

/** A foreign key to another entity would join this key against that one's, returning unrelated rows. */
it('should refuse an inverse relation mapped by a field referencing another entity', () => {
  @Entity()
  class Reader {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Review {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Reader).nullable()) readerId?: number | null;
  }
  @Entity()
  class Critic {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Review, mappedBy: (review) => review.readerId })
    reviews?: Review[];
  }

  expect(() => getMeta(Critic)).toThrow(
    "'Critic.reviews' joins 'Review.readerId', a foreign key to 'Reader', not to 'Critic'.",
  );
});

it('should refuse a to-many joining columns whose foreign key, on the other side, references another entity', () => {
  @Entity()
  class Crew {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Sailor {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Crew).nullable()) crewId?: number | null;
  }
  @Entity()
  class Captain {
    @Field(f.number().id()) id?: number;
    @OneToMany({
      entity: () => Sailor,
      references: (captain, sailor) => [{ local: captain.id, foreign: sailor.crewId }],
    })
    sailors?: Sailor[];
  }

  expect(() => getMeta(Captain)).toThrow(
    "'Captain.sailors' joins 'Sailor.crewId', a foreign key to 'Crew', not to 'Captain'.",
  );
});

it('should refuse an inverse relation mapped by a relation to another entity', () => {
  @Entity()
  class Editor {
    @Field(f.number().id()) id?: number;
  }
  @Entity()
  class Draft {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) editorId?: number | null;
    @ManyToOne({ entity: () => Editor, references: (draft) => draft.editorId }) editor?: Editor;
  }
  @Entity()
  class Proofreader {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Draft, mappedBy: (draft) => draft.editor }) drafts?: Draft[];
  }

  expect(() => getMeta(Proofreader)).toThrow(
    "'Proofreader.drafts' is mapped by 'Draft.editor', a relation to 'Editor', not to 'Proofreader'.",
  );
});

it('should accept an inverse relation mapped by a field referencing the entity it inherits it from', () => {
  @Entity()
  class Shelf {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Volume, mappedBy: (volume) => volume.shelfId })
    volumes?: Volume[];
  }
  @Entity()
  class Bookcase extends Shelf {
    @Field(f.string().nullable()) label?: string | null;
  }
  @Entity()
  class Volume {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Shelf).nullable()) shelfId?: number | null;
  }

  expect(getMeta(Bookcase).relations.volumes?.references).toEqual([{ local: 'id', foreign: 'shelfId' }]);
});

/** The message a registration error carries, for a test that pins what it says and not how. */
function getError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  throw new Error('expected a registration error');
}

/** A column pointing at a class that is no entity constrains nothing; the schema build reads it again later. */
it('should hold no foreign key for a column whose target registers no key', () => {
  class Shelf {
    id?: number;
  }
  @Entity()
  class Book {
    @Field(f.number().id()) id?: number;
    @Field(
      f
        .number()
        .nullable()
        .references(() => Shelf),
    )
    shelfId?: number | null;
  }

  expect(foreignKeysOf(getMeta(Book))).toEqual([]);
});

/** One column cannot reference a two-column key; the relation decorators make one column per key. */
it('should refuse a plain foreign key pointing at a composite key', () => {
  @Entity()
  class Enrolment {
    [idKey]?: 'studentId' | 'courseId';
    @Field(f.number().id()) studentId?: number;
    @Field(f.string().id()) courseId?: string;
  }
  @Entity()
  class Note {
    @Field(f.number().id()) id?: number;
    // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
    @Field(f.references(() => Enrolment).nullable()) enrolmentStudentId?: number | null;
  }

  // The column, the key it cannot reach, and the decorator that can: the rest is wording.
  const error = getError(() => getMeta(Note));
  expect(error).toContain(`'Note.enrolmentStudentId'`);
  expect(error).toContain('composite (studentId, courseId)');
  expect(error).toContain("pair each with it in a '@ManyToOne' to 'Enrolment'");
});

/** Every column of the parent's key, or the ones it did not replace would widen the child's. */
it('should drop every key of a composite parent from a subclass declaring its own', () => {
  @Entity()
  class Pair {
    [idKey]?: 'left' | 'right';
    @Field(f.number().id()) left?: number;
    @Field(f.number().id()) right?: number;
    @Field(f.string().nullable()) label?: string | null;
  }
  @Entity()
  class Single extends Pair {
    @Field(f.number().id()) id?: number;
  }

  const meta = getMeta(Single);
  expect(meta.ids).toEqual(['id']);
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'label']);
});

it('should inherit the parent fields in a subclass declaring the only @Id', () => {
  class IdlessBase {
    @Field(f.string().nullable())
    name?: string | null;
  }

  @Entity()
  class IdentifiedChild extends IdlessBase {
    @Field(f.number().id())
    id?: number;
  }

  const meta = getMeta(IdentifiedChild);
  expect(meta.ids[0]).toBe('id');
  expect(getKeys(meta.fields).sort()).toEqual(['id', 'name']);
});

it("should inherit the parent's softDelete field key and filters in a subclass", () => {
  @Entity({ filters: { active: { where: { status: 'active' }, default: false } } })
  class SoftBase {
    @Field(f.number().id())
    id?: number;
    @Field(f.string().nullable())
    status?: string | null;
    @Field(f.date().nullable().softDelete())
    deletedAt?: Date | null;
  }

  @Entity()
  class SoftChild extends SoftBase {
    @Field(f.string().nullable())
    name?: string | null;
  }

  const meta = getMeta(SoftChild);
  expect(meta.softDelete).toBe('deletedAt');
  expect(meta.filters?.['softDelete']).toEqual({ where: { deletedAt: null }, default: true });
  expect(meta.filters?.['active']).toEqual({ where: { status: 'active' }, default: false });
});

it('should inherit the fields, relations, hooks and filters of a base and its own base', () => {
  class Timestamped {
    @Field(f.date()) createdAt?: Date;
    @BeforeInsert() stamp(): void {}
  }

  @Entity({ abstract: true, filters: { mine: { where: { ownerId: 'u1' }, default: false } } })
  class Owned extends Timestamped {
    @Field(f.string()) ownerId?: string;
    @ManyToOne({ entity: () => User, references: (owned) => owned.ownerId }) owner?: User;
  }

  @Entity()
  class Ticket extends Owned {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) title?: string | null;
  }

  const meta = getMeta(Ticket);
  expect(getKeys(meta.fields).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title']);
  expect(meta.relations['owner']?.references).toEqual([{ local: 'ownerId', foreign: 'id' }]);
  expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'stamp' }]);
  expect(meta.filters?.['mine']).toEqual({ where: { ownerId: 'u1' }, default: false });
  expect(meta.ids).toEqual(['id']);
});

it('should keep an entity base in its own table, and the child what it declares itself', () => {
  @Entity({ name: 'auditable' })
  class Auditable {
    @Field(f.number().id()) id?: number;
    @Field(f.string()) label?: string;
    @Field(f.boolean().nullable()) archived?: boolean | null;
  }

  @Entity()
  class Invoice extends Auditable {
    declare [idKey]?: 'ref';
    @Field(f.string().id()) ref?: string;
  }

  const meta = getMeta(Invoice);
  expect(meta.name).toBe('Invoice');
  expect(meta.ids).toEqual(['ref']);
  expect(getKeys(meta.fields).sort()).toEqual(['archived', 'label', 'ref']);
  expect(meta.fields['label']).toMatchObject({ type: String });
  expect(meta.fields['label']?.nullable).toBeUndefined();
  expect(getMeta(Auditable).name).toBe('auditable');
});

it('should keep the relations a junction declares itself', () => {
  @Entity()
  class Screening {
    @Field(f.number().id())
    id?: number;
  }

  @Entity()
  class Note {
    @Field(f.number().id())
    id?: number;
    @Field(f.number().nullable())
    filmScreeningId?: number | null;
  }

  @Entity()
  class FilmScreening {
    @Field(f.number().id())
    id?: number;
    @Field(f.references(() => Film).nullable())
    filmId?: number | null;
    @ManyToOne({ entity: () => Film, cascade: 'persist', references: (filmScreening) => filmScreening.filmId })
    film?: Film;
    @Field(f.references(() => Screening).nullable())
    screeningId?: number | null;
    @OneToMany({ entity: () => Note, mappedBy: (note) => note.filmScreeningId })
    notes?: Note[];
  }

  @Entity()
  class Film {
    @Field(f.number().id())
    id?: number;
    @ManyToMany({ entity: () => Screening, through: () => FilmScreening })
    screenings?: Screening[];
  }

  expect(getMeta(Film).relations.screenings?.references).toEqual([
    { local: 'filmId', foreign: 'id' },
    { local: 'screeningId', foreign: 'id' },
  ]);
  const junction = getMeta(FilmScreening);
  expect(junction.relations.film?.cascade).toBe('persist');
  expect(junction.relations.notes?.references).toEqual([{ local: 'id', foreign: 'filmScreeningId' }]);
});

it('should refuse a delete cascade on a to-one holding the key, whose target other rows may point at', () => {
  @Entity()
  class Venue {
    @Field(f.number().id())
    id?: number;
  }

  @Entity()
  class Gig {
    @Field(f.number().id())
    id?: number;
    @Field(f.references(() => Venue).nullable())
    venueId?: number | null;
    // @ts-expect-error a to-one holding the key cascades 'persist' only
    @ManyToOne({ entity: () => Venue, references: (gig) => gig.venueId, cascade: true })
    venue?: Venue;
  }

  expect(() => getMeta(Gig)).toThrow("'Gig.venue' holds the key of a 'Venue' other rows may point at too");
});

it('should refuse a mappedBy naming an inverse side, since neither side owns the foreign key', () => {
  @Entity()
  class Passport {
    @Field(f.number().id())
    id?: number;
    @OneToMany({ entity: () => Traveller, mappedBy: (traveller) => traveller.passports })
    travellers?: Traveller[];
  }

  @Entity()
  class Traveller {
    @Field(f.number().id())
    id?: number;
    @OneToMany({ entity: () => Passport, mappedBy: (passport) => passport.travellers })
    passports?: Passport[];
  }

  expect(() => getMeta(Traveller)).toThrow(
    `'Traveller.passports' is mapped by 'Passport.travellers', an inverse side too, so neither owns the foreign key.`,
  );
});

/** Types keep the two apart; this is the guard for a caller they cannot see, such as plain JavaScript. */
it('should refuse references on a relation through a junction, whose own columns say how it joins', () => {
  expect(() => {
    @Entity()
    class Shelf {
      @Field(f.number().id()) id?: number;
      // @ts-expect-error the type refuses it too; this covers the runtime guard for untyped callers
      @ManyToMany({ entity: () => Shelf, through: () => Shelf, references: () => [] }) shelves?: Shelf[];
    }
    return Shelf;
  }).toThrow(
    "'Shelf.shelves' joins through a junction, whose column referencing each side is the join; 'references' pairs the declaring entity's columns with the target's instead.",
  );
});

it('should say so for a relation with no columns to join on', () => {
  @Entity()
  class Terminal {
    @Field(f.number().id()) id?: number;
  }

  @Entity()
  class Gate {
    @Field(f.number().id()) id?: number;
    // Hand-written and empty: nothing filled it in, so nothing says how the two are joined.
    @ManyToOne({ entity: () => Terminal, references: () => [] }) terminal?: Terminal;
  }

  expect(() => getMeta(Gate)).toThrow("'Gate.terminal' has no columns to join on.");
});

it('should register the indexes an entity lists and the hooks its methods mark', () => {
  @Entity({
    indexes: (indexed, index) => [
      index([indexed.email, indexed.status], { name: 'email_status_idx', unique: false }),
      index([indexed.email], { include: [indexed.status], unique: true }),
    ],
  })
  class Indexed {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) email?: string | null;
    @Field(f.string().nullable()) status?: string | null;

    @BeforeInsert() stampCreatedAt() {}
    @AfterLoad() hydrate() {}
  }

  const m = getMeta(Indexed);
  expect(m.indexes).toHaveLength(2);
  expect(m.indexes?.[0]).toMatchObject({
    entries: [{ column: 'email' }, { column: 'status' }],
    name: 'email_status_idx',
    unique: false,
  });
  expect(m.indexes?.[1]).toMatchObject({ entries: [{ column: 'email' }], include: ['status'], unique: true });
  // The authored callback is read into `entries`, never kept beside them.
  expect(m.indexes?.[0]).not.toHaveProperty('columns');
  expect(m.hooks?.beforeInsert).toMatchObject([{ methodName: 'stampCreatedAt' }]);
  expect(m.hooks?.afterLoad).toMatchObject([{ methodName: 'hydrate' }]);
});

it("should inherit a parent's fields when the parent was finalized first", () => {
  @Entity()
  class ParentEntity {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) baseCol?: string | null;
  }
  expect(getMeta(ParentEntity).ids).toEqual(['id']);

  @Entity()
  class ChildEntity extends ParentEntity {
    @Field(f.boolean().nullable()) childCol?: boolean | null;
  }

  const m = getMeta(ChildEntity);
  expect(m.fields['id']?.isId).toBe(true);
  expect(m.fields['baseCol']?.type).toBe(String);
  expect(m.fields['childCol']?.type).toBe(Boolean);
  expect(m.ids).toEqual(['id']);
});

it('keyOf should answer the member a selector reads', () => {
  expect(keyOf((user: KeyMap<User>) => user.email)).toBe('email');
  expect(keyOf((user: KeyMap<User>) => user.profile)).toBe('profile');
});

/** The one choice there is is the one taken: the column referencing the target, the relation pointing back. */
it('should infer a relation join where only one column or relation can be it', () => {
  @Entity()
  class Kennel {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Hound }) hounds?: Hound[];
  }
  @Entity()
  class Hound {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Kennel).nullable()) kennelId?: number | null;
    @ManyToOne({ entity: () => Kennel }) kennel?: Kennel;
  }

  expect(getMeta(Hound).relations.kennel?.references).toEqual([{ local: 'kennelId', foreign: 'id' }]);
  expect(getMeta(Kennel).relations.hounds).toMatchObject({
    mappedBy: 'kennel',
    references: [{ local: 'id', foreign: 'kennelId' }],
  });
});

it('should name the candidates where a relation join could be either', () => {
  @Entity()
  class Port {
    @Field(f.number().id()) id?: number;
    @OneToMany({ entity: () => Voyage }) voyages?: Voyage[];
  }
  @Entity()
  class Voyage {
    @Field(f.number().id()) id?: number;
    @Field(f.references(() => Port).nullable()) fromId?: number | null;
    @Field(f.references(() => Port).nullable()) toId?: number | null;
    @ManyToOne({ entity: () => Port }) from?: Port;
    @ManyToOne({ entity: () => Port, references: (voyage) => voyage.toId }) to?: Port;
  }

  expect(() => getMeta(Voyage)).toThrow(
    "'Voyage.from' could join by 'fromId' or 'toId', each a foreign key to 'Port': name one with 'references'.",
  );
  expect(() => getMeta(Port)).toThrow(
    "'Port.voyages' could be mapped by 'from' or 'to', each a relation to 'Port': name one with 'mappedBy'.",
  );
});
