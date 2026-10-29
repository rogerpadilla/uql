import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import {
  BeforeInsert,
  Computed,
  Entity,
  f,
  Field,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
} from '../entity/index.js';
import { idKey, type Json, versionKey } from '../type/index.js';

/** The fields most fixtures share. */
export abstract class BaseEntity {
  /**
   * A client-generated key, so the same entity runs on every backend: MongoDB cannot mint a number, so a
   * key left to the database is a SQL-only shape, which {@link Invoice} declares. Version 7 rather than
   * random, so insertion order is still key order.
   */
  @Field(f.string().id().onInsert(uuidv7))
  id?: string;

  @Field(f.references(() => Company).nullable())
  companyId?: string | null;

  @ManyToOne({ entity: () => Company, references: (baseEntity) => baseEntity.companyId })
  company?: Company;

  @Field(f.references(() => User).nullable())
  creatorId?: string | null;

  @ManyToOne({ entity: () => User, references: (baseEntity) => baseEntity.creatorId })
  creator?: User;

  @Field(f.number().nullable().onInsert(Date.now))
  createdAt?: number | null;

  @Field(f.number().nullable().onUpdate(Date.now))
  updatedAt?: number | null;
}

export type CompanyKind = {
  public?: 0 | 1;
  private?: 0 | 1;
  tags?: string[];
  /** An array holding nulls, which every operator compares as JSON's null. */
  notes?: (string | null)[];
  /** Second array key, so `$push`/`$pull` on two keys at once stays typed in the specs. */
  labels?: string[];
  /** An array key spelled as SQL's NULL, which a JSON path has to quote. */
  null?: string[];
  /**
   * Array of objects, so `$elemMatch` on a JSON dot-path is covered with typed element fields:
   * a string, a boolean, a number (plain-equality vs `$eq` must agree) and a nullable field.
   */
  items?: { name?: string; active?: boolean; count?: number; note?: string | null }[];
  /** Array of scalars, for `$elemMatch` conditions applied to the element itself. */
  flags?: boolean[];
  /** Array of numbers, which a scalar `$elemMatch` compares as numbers. */
  ranks?: number[];
  /** A fraction, which a comparison must not round. */
  rating?: number;
  description?: string;
  country?: string;
  theme?: { color?: string | null; size?: number };
  meta?: Record<string, unknown>;
  isArchived?: boolean;
};

@Entity()
export class Company extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable())
  description?: string | null;

  @Field(f.jsonb().nullable())
  kind?: Json<CompanyKind> | null;
}

@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  // Names the key for the type level: the inherited `id` would otherwise be taken for it, since a
  // conventional name outranks the fallback and nothing else says `pk` replaced it.
  [idKey]?: 'pk';

  @Field(f.string().id().onInsert(uuidv7))
  pk?: string;

  @Field(f.string().nullable().name('image'))
  picture?: string | null;

  // Narrows the inherited m1 relation to 1-1. A real field rather than `declare`, because the standard
  // decorator spec has nothing to decorate on a `declare` member; the initializer marks the shadowing as
  // deliberate.
  @OneToOne({ entity: () => User, references: (profile) => profile.creatorId })
  override creator?: User = undefined;
}

@Entity()
export class User extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable().updatable(false))
  email?: string | null;

  @Field(f.string().nullable().eager(false))
  password?: string | null;

  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.creator, cascade: true })
  profile?: Profile;

  @OneToMany({ entity: () => User, mappedBy: (user) => user.creator })
  users?: User[];
}

@Entity()
export class UserWithNonUpdatableId {
  @Field(f.number().id().updatable(false))
  id!: number;

  @Field(f.string().nullable())
  name!: string | null;
}

/** The optimistic-lock fixture: the `versionKey` brand is what makes an update payload require it. */
@Entity()
export class VersionedNote {
  [versionKey]?: 'version';

  @Field(f.uuid().id().onInsert(uuidv7))
  id?: string;

  @Field(f.string().nullable())
  title?: string | null;

  @Field(f.version())
  version?: number;

  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedAt?: number | null;
}

/** The lock on a wide counter: a `BigInt` version exercises each driver's own BIGINT decoding. */
@Entity()
export class WideVersionedNote {
  [versionKey]?: 'version';

  @Field(f.uuid().id().onInsert(uuidv7))
  id?: string;

  @Field(f.string().nullable())
  title?: string | null;

  @Field(f.version(BigInt))
  version?: bigint;
}

/** The row-level-security fixture: scoped to the context's `tenantId`, open to a `system` one. */
@Entity({
  filters: {
    tenant: {
      where: (ctx) => {
        const tenantId = ctx?.['tenantId'];
        return ctx?.['system'] ? {} : typeof tenantId === 'string' ? { tenantId } : undefined;
      },
      security: true,
    },
  },
})
export class TenantNote {
  @Field(f.string().id().onInsert(uuidv7))
  id?: string;

  @Field(f.string().nullable())
  tenantId?: string | null;

  @Field(f.string().nullable())
  title?: string | null;
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable())
  description?: string | null;

  @Field(f.references(() => LedgerAccount).nullable())
  parentLedgerId?: string | null;

  @ManyToOne({ entity: () => LedgerAccount, references: (ledgerAccount) => ledgerAccount.parentLedgerId })
  parentLedger?: LedgerAccount;
}

@Entity()
export class TaxCategory extends BaseEntity {
  /** Names the key for the type level, as on {@link Profile}. */
  [idKey]?: 'pk';

  @Field(f.string().id().onInsert(randomUUID))
  pk?: string;

  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable())
  description?: string | null;
}

@Entity()
export class Tax extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.number().nullable())
  percentage?: number | null;

  @Field(f.references(() => TaxCategory).nullable())
  categoryId?: string | null;

  @ManyToOne({ entity: () => TaxCategory, references: (tax) => tax.categoryId })
  category?: TaxCategory;

  @Field(f.string().nullable())
  description?: string | null;
}

/** Soft deletable: a delete stamps `deletedAt` instead of removing the row. */
@Entity()
export class MeasureUnitCategory extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @OneToMany({ entity: () => MeasureUnit, mappedBy: (measureUnit) => measureUnit.categoryId })
  measureUnits?: MeasureUnit[];

  /** A relation aggregate, read only where a query names it, and never counting a soft-deleted unit. */
  @Computed((category) => category.measureUnits.count())
  readonly unitCount?: number;

  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedAt?: number | null;
}

@Entity()
export class MeasureUnit extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.references(() => MeasureUnitCategory).nullable())
  categoryId?: string | null;

  @ManyToOne({
    entity: () => MeasureUnitCategory,
    references: (measureUnit) => measureUnit.categoryId,
    cascade: 'persist',
  })
  category?: MeasureUnitCategory;

  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedAt?: number | null;
}

@Entity()
export class Storehouse extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable())
  address?: string | null;

  @Field(f.string().nullable())
  description?: string | null;
}

@Entity()
export class Item extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable())
  description?: string | null;

  @Field(f.string().nullable())
  code?: string | null;

  @Field(f.references(() => LedgerAccount).nullable())
  buyLedgerAccountId?: string | null;

  @ManyToOne({ entity: () => LedgerAccount, references: (item) => item.buyLedgerAccountId })
  buyLedgerAccount?: LedgerAccount;

  @Field(f.references(() => LedgerAccount).nullable())
  saleLedgerAccountId?: string | null;

  @ManyToOne({ entity: () => LedgerAccount, references: (item) => item.saleLedgerAccountId })
  saleLedgerAccount?: LedgerAccount;

  @Field(f.references(() => Tax).nullable())
  taxId?: string | null;

  @ManyToOne({ entity: () => Tax, references: (item) => item.taxId })
  tax?: Tax;

  @Field(f.references(() => MeasureUnit).nullable())
  measureUnitId?: string | null;

  @ManyToOne({ entity: () => MeasureUnit, references: (item) => item.measureUnitId })
  measureUnit?: MeasureUnit;

  @Field(f.number().nullable())
  salePrice?: number | null;

  @Field(f.boolean().nullable())
  inventoryable?: boolean | null;

  @ManyToMany({ entity: () => Tag, through: () => ItemTag, cascade: true })
  tags?: Tag[];

  /**
   * An unstored relation aggregate: the subquery is spliced into each statement that reads it, so it is
   * never a column and works in `$select`, `$where` and `$sort` like any other field.
   */
  @Computed((item) => item.tags.count())
  readonly tagsCount?: number;
}

@Entity()
export class Tag extends BaseEntity {
  @Field(f.string().nullable())
  name?: string | null;

  @ManyToMany({ entity: () => Item, mappedBy: (item) => item.tags })
  items?: Item[];

  /** The same aggregate from the inverse side of the many-to-many, counting the junction's rows. */
  @Computed((tag) => tag.items.count())
  readonly itemsCount?: number;
}

@Entity()
export class ItemTag {
  @Field(f.string().id().onInsert(uuidv7))
  id?: string;

  @Field(f.references(() => Item).nullable())
  itemId?: string | null;

  @Field(f.references(() => Tag).nullable())
  tagId?: string | null;
}

@Entity()
export class InventoryAdjustment extends BaseEntity {
  @OneToMany({
    entity: () => ItemAdjustment,
    mappedBy: (itemAdjustment) => itemAdjustment.inventoryAdjustment,
    cascade: true,
  })
  itemAdjustments?: ItemAdjustment[];

  @Field(f.date().nullable())
  date?: Date | null;

  @Field(f.string().nullable())
  description?: string | null;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @Field(f.references(() => Item).nullable())
  itemId?: string | null;

  @ManyToOne({ entity: () => Item, references: (itemAdjustment) => itemAdjustment.itemId })
  item?: Item;

  @Field(f.number().nullable())
  number?: number | null;

  @Field(f.number().nullable())
  buyPrice?: number | null;

  @Field(f.references(() => Storehouse).nullable())
  storehouseId?: string | null;

  @ManyToOne({ entity: () => Storehouse, references: (itemAdjustment) => itemAdjustment.storehouseId })
  storehouse?: Storehouse;

  @Field(f.references(() => InventoryAdjustment).nullable())
  inventoryAdjustmentId?: string | null;

  @ManyToOne({
    entity: () => InventoryAdjustment,
    references: (itemAdjustment) => itemAdjustment.inventoryAdjustmentId,
  })
  inventoryAdjustment?: InventoryAdjustment;
}

/**
 * SQL-only: the one fixture that leaves its key to the database on purpose. The shared entities carry
 * a client-generated key so they run on MongoDB, which cannot mint a number; the tests that mix
 * supplied and generated keys in one batch, or read the ids a driver infers, need auto-increment to
 * exist. `lines` is the cascade those tests write with a parent id the driver had to report.
 */
@Entity()
export class Invoice {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable())
  description?: string | null;

  @OneToMany({
    entity: () => InvoiceLine,
    mappedBy: (invoiceLine) => invoiceLine.invoice,
    cascade: true,
  })
  lines?: InvoiceLine[];
}

@Entity()
export class InvoiceLine {
  @Field(f.number().id())
  id?: number;

  @Field(f.number().nullable())
  amount?: number | null;

  @Field(f.references(() => Invoice).nullable())
  invoiceId?: number | null;

  @ManyToOne({ entity: () => Invoice, references: (invoiceLine) => invoiceLine.invoiceId })
  invoice?: Invoice;
}

/**
 * Auto-increment PK + a separately-unique conflict column, dedicated to `upsertMany` id-return
 * tests: `code` (not the PK) is the conflict key, so a newly-inserted row's id is only knowable
 * from the database's response, never from the payload itself.
 */
@Entity()
export class Coupon {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable().unique()) code?: string | null;
  @Field(f.string().nullable()) label?: string | null;
}

/**
 * One column per declared JS type, for the round-trip that asserts a read gives back what the entity
 * promised. Engines disagree wildly underneath: `Number` becomes BIGINT (or DECIMAL with a scale),
 * `Boolean` becomes TINYINT(1) or a plain INTEGER, and several drivers hand every one of those back
 * as text.
 */
@Entity()
export class TypedRow {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.number().nullable()) count?: number | null;
  /** precision/scale makes this DECIMAL/NUMERIC, which pg and mysql2 both return as a string. */
  @Field(f.number().nullable().precision(12).scale(2)) amount?: number | null;
  @Field(f.boolean().nullable()) enabled?: boolean | null;
  /**
   * The opt-out from that: `columnType` still makes it DECIMAL, but declaring `String` keeps it off
   * the numeric path, so a value wider than 2^53 survives as the exact text the driver returned.
   */
  @Field(f.decimal(30, 2).nullable()) exact?: string | null;
  /** A BIGINT written from a `bigint`, which only an exact bind keeps apart from its rounded neighbour. */
  @Field(f.bigint().nullable()) wide?: bigint | null;
  @Field(f.date().nullable()) at?: Date | null;
  /** A timestamp without a zone, which holds UTC on every engine. */
  @Field(f.date().nullable().columnType('timestamp')) zonelessAt?: Date | null;
  /** A calendar day, the UTC midnight `new Date('2026-09-10')` parses to. */
  @Field(f.date().nullable().columnType('date')) day?: Date | null;
  @Field(f.column('blob').nullable()) bytes?: Uint8Array | null;
  @Field(f.references(() => TypedGroup).nullable()) groupId?: number | null;
  @ManyToOne({ entity: () => TypedGroup, references: (typedRow) => typedRow.groupId }) group?: TypedGroup;
}

/** Holds {@link TypedRow}s, so a populated row can be read back beside a read of its own. */
@Entity()
export class TypedGroup {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @OneToMany({ entity: () => TypedRow, mappedBy: (typedRow) => typedRow.group }) rows?: TypedRow[];
}

@Entity()
export class VectorItem {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.vector(3).nullable()) vec!: number[] | null;
}

/**
 * A document, its chunks and the chunks it cites, every one with a vector named `vec`: a join tells
 * them apart by alias only, and a relation sort ranks a document by its nearest chunk.
 */
@Entity()
export class VectorDoc {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.vector(3).nullable()) vec?: number[] | null;
  @OneToMany({ entity: () => VectorChunk, mappedBy: (chunk) => chunk.doc }) chunks?: VectorChunk[];
  @ManyToMany({ entity: () => VectorChunk, through: () => VectorCitation }) cited?: VectorChunk[];
  /** A column of a many-to-many's targets, which a junction row does not carry. */
  @Computed((doc) => doc.cited.max((chunk) => chunk.name)) readonly lastCited?: string | null;
}

@Entity()
export class VectorChunk {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.vector(3).nullable()) vec?: number[] | null;
  @Field(f.references(() => VectorDoc).nullable()) vectorDocId?: string | null;
  @ManyToOne({ entity: () => VectorDoc, references: (chunk) => chunk.vectorDocId }) doc?: VectorDoc;
}

@Entity()
export class VectorCitation {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.references(() => VectorDoc).nullable()) vectorDocId?: string | null;
  @Field(f.references(() => VectorChunk).nullable()) vectorChunkId?: string | null;
}

/**
 * pgvector's narrower vector types, which every other dialect maps onto the one it has. Their point
 * here is the round-trip: `sparsevec` rejects the dense literal the others take, which a SQL-text
 * assertion cannot show.
 */
@Entity()
export class NarrowVectorItem {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.column('halfvec').nullable().dimensions(3)) half!: number[] | null;
  @Field(f.column('sparsevec').nullable().dimensions(3)) sparse!: number[] | null;
}

/**
 * A JSON array column, for the JSON array operators in a filter and an update. The `unknown[]` element
 * type keeps values unchecked, so a test can store any shape.
 */
@Entity()
export class JsonRecord {
  @Field(f.number().id()) id?: number;
  @Field(f.json().nullable()) entries?: Json<unknown[]> | null;
}

/** Holds {@link JsonValue}s, so a JSON column is read through a to-many as well as on its own. */
@Entity()
export class JsonHolder {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) name?: string | null;
  @OneToMany({ entity: () => JsonValue, mappedBy: (jsonValue) => jsonValue.holder }) values?: JsonValue[];
}

/** A JSON column holding any value, a bare string included, which reads back as the string it is. */
@Entity()
export class JsonValue {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.number().nullable()) position?: number | null;
  @Field(f.references(() => JsonHolder).nullable()) holderId?: string | null;
  @ManyToOne({ entity: () => JsonHolder, references: (jsonValue) => jsonValue.holderId }) holder?: JsonHolder;
  @Field(f.json().nullable()) value?: Json<string | number | boolean | { [key: string]: unknown } | unknown[]> | null;
}

/** An untyped JSON column, which holds any shape, as documents an older writer left do. */
@Entity()
export class LooseDoc {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.jsonb().nullable()) doc?: Json | null;
}

/** A JSON column beside a column of each type its paths hold, for comparing a field with another column. */
@Entity()
export class Reading {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.number().nullable()) low?: number | null;
  @Field(f.number().nullable()) high?: number | null;
  @Field(f.boolean().nullable()) open?: boolean | null;
  @Field(f.jsonb().nullable()) doc?: Json<{ score?: number; name?: string; open?: boolean }> | null;
}

/** A reference stored under its relation's name, as Mongoose stores a `ref`. */
@Entity()
export class Reply {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) text?: string | null;
  @Field(
    f
      .references(() => User)
      .nullable()
      .name('author'),
  )
  authorId?: string | null;
  @ManyToOne({ entity: () => User, references: (reply) => reply.authorId }) author?: User;
}

/** A to-one target several {@link Shipment}s may point at, written before the row holding its key. */
@Entity()
export class Carrier extends BaseEntity {
  @Field(f.string().nullable().unique()) code?: string | null;
  @Field(f.string().nullable()) name?: string | null;
}

/** The target of an owning one-to-one: {@link Shipment} holds its key. */
@Entity()
export class Waybill extends BaseEntity {
  @Field(f.string().nullable()) number?: string | null;
}

/** A soft-deleting parent holding a to-one's key, and owning a to-many and a many-to-many. */
@Entity()
export class Shipment extends BaseEntity {
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.references(() => Carrier).nullable()) carrierId?: string | null;
  @ManyToOne({ entity: () => Carrier, references: (shipment) => shipment.carrierId, cascade: 'persist' })
  carrier?: Carrier;
  @Field(f.references(() => Waybill).nullable()) waybillId?: string | null;
  @OneToOne({ entity: () => Waybill, references: (shipment) => shipment.waybillId, cascade: 'persist' })
  waybill?: Waybill;
  @OneToMany({ entity: () => Parcel, mappedBy: (parcel) => parcel.shipment, cascade: true }) parcels?: Parcel[];
  @ManyToMany({ entity: () => Label, through: () => ShipmentLabel, cascade: true }) labels?: Label[];
  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedAt?: number | null;
}

/** A child that cannot soft-delete, so a soft-deleted {@link Shipment} keeps it. */
@Entity()
export class Parcel extends BaseEntity {
  @Field(f.string().nullable()) content?: string | null;
  @Field(f.number().nullable()) weight?: number | null;
  @Field(f.references(() => Shipment).nullable()) shipmentId?: string | null;
  @ManyToOne({ entity: () => Shipment, references: (parcel) => parcel.shipmentId }) shipment?: Shipment;
}

@Entity()
export class Label extends BaseEntity {
  @Field(f.string().nullable().unique()) name?: string | null;

  /** Fails a write naming `boom`, so a cascade can fail after its parent was written, on every engine. */
  @BeforeInsert()
  refuseBoom() {
    if (this.name === 'boom') {
      throw new Error('boom');
    }
  }
}

@Entity()
export class ShipmentLabel {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.references(() => Shipment).nullable()) shipmentId?: string | null;
  @Field(f.references(() => Label).nullable()) labelId?: string | null;
}

/** A relation the database cascades on its own, through the `ON DELETE CASCADE` its constraint declares. */
@Entity()
export class Shelf {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) label?: string | null;
}

@Entity()
export class ShelfBook {
  @Field(f.number().id()) id?: number;
  @Field(
    f
      .references(() => Shelf)
      .nullable()
      .onDelete('CASCADE'),
  )
  shelfId?: number | null;
}

/** A composite key (a year and a track) owning a to-many and two many-to-manys, one to a composite target and one to a sole one. */
@Entity()
export class Cohort {
  [idKey]?: 'year' | 'track';
  @Field(f.number().id()) year?: number;
  @Field(f.string().id()) track?: string;
  @Field(f.string().nullable()) title?: string | null;
  @OneToMany({ entity: () => Seminar, mappedBy: (seminar) => seminar.cohort, cascade: true }) seminars?: Seminar[];
  @ManyToMany({ entity: () => Skill, through: () => CohortSkill, cascade: true }) skills?: Skill[];
  @ManyToMany({ entity: () => Label, through: () => CohortLabel, cascade: true }) labels?: Label[];
}

/** A sole-key child of a {@link Cohort}, and a parent of composite targets itself. */
@Entity()
export class Seminar {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.number().nullable()) cohortYear?: number | null;
  @Field(f.string().nullable()) cohortTrack?: string | null;
  @ManyToOne({
    entity: () => Cohort,
    references: (seminar, cohort) => [
      { local: seminar.cohortYear, foreign: cohort.year },
      { local: seminar.cohortTrack, foreign: cohort.track },
    ],
  })
  cohort?: Cohort;
  @ManyToMany({ entity: () => Skill, through: () => SeminarSkill, cascade: true }) skills?: Skill[];
}

/** A many-to-many target whose key is two columns. */
@Entity()
export class Skill {
  [idKey]?: 'area' | 'name';
  @Field(f.string().id()) area?: string;
  @Field(f.string().id()) name?: string;
  @Field(f.string().nullable()) note?: string | null;
}

/** Four key columns, a composite on each side. */
@Entity()
export class CohortSkill {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.number().nullable()) cohortYear?: number | null;
  @Field(f.string().nullable()) cohortTrack?: string | null;
  @ManyToOne({
    entity: () => Cohort,
    references: (link, cohort) => [
      { local: link.cohortYear, foreign: cohort.year },
      { local: link.cohortTrack, foreign: cohort.track },
    ],
  })
  cohort?: Cohort;
  @Field(f.string().nullable()) skillArea?: string | null;
  @Field(f.string().nullable()) skillName?: string | null;
  @ManyToOne({
    entity: () => Skill,
    references: (link, skill) => [
      { local: link.skillArea, foreign: skill.area },
      { local: link.skillName, foreign: skill.name },
    ],
  })
  skill?: Skill;
}

/** A composite parent linked to a sole-key target. */
@Entity()
export class CohortLabel {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.number().nullable()) cohortYear?: number | null;
  @Field(f.string().nullable()) cohortTrack?: string | null;
  @ManyToOne({
    entity: () => Cohort,
    references: (link, cohort) => [
      { local: link.cohortYear, foreign: cohort.year },
      { local: link.cohortTrack, foreign: cohort.track },
    ],
  })
  cohort?: Cohort;
  @Field(f.references(() => Label).nullable()) labelId?: string | null;
}

/** A sole-key parent linked to a composite target. */
@Entity()
export class SeminarSkill {
  @Field(f.string().id().onInsert(uuidv7)) id?: string;
  @Field(f.references(() => Seminar).nullable()) seminarId?: string | null;
  @Field(f.string().nullable()) skillArea?: string | null;
  @Field(f.string().nullable()) skillName?: string | null;
  @ManyToOne({
    entity: () => Skill,
    references: (link, skill) => [
      { local: link.skillArea, foreign: skill.area },
      { local: link.skillName, foreign: skill.name },
    ],
  })
  skill?: Skill;
}
