import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { Entity, Field, Id, ManyToMany, ManyToOne, OneToMany, OneToOne } from '../entity/index.js';
import { idKey, type Json } from '../type/index.js';

/**
 * an `abstract` class can (optionally) be used as the base "template" for the entities
 * (so common fields' declaration is easily reused).
 */
export abstract class BaseEntity {
  /**
   * A client-generated key, so the same entity runs on every backend: MongoDB cannot mint a number,
   * so a key left to the database is a SQL-only shape - {@link Invoice} declares one for the tests
   * that need it. Version 7 rather than random, so insertion order is still key order, which is
   * what the auto-increment it replaces gave and what the docs recommend for the same reason.
   */
  @Id({ type: String, onInsert: uuidv7 })
  id?: string;

  /**
   * foreign-keys are really simple to specify with the `references` property.
   */
  @Field({ references: () => Company })
  companyId?: string | null;

  @ManyToOne({ entity: () => Company, references: (baseEntity) => baseEntity.companyId })
  company?: Company;

  @Field({ references: () => User })
  creatorId?: string | null;

  @ManyToOne({ entity: () => User, references: (baseEntity) => baseEntity.creatorId })
  creator?: User;

  /**
   * 'onInsert' property can be used to specify a custom mechanism for
   * obtaining the value of a field when inserting:
   */
  @Field({ type: Number, onInsert: Date.now })
  createdAt?: number | null;

  /**
   * 'onUpdate' property can be used to specify a custom mechanism for
   * obtaining the value of a field when updating:
   */
  @Field({ type: Number, onUpdate: Date.now })
  updatedAt?: number | null;
}

export type CompanyKindKey = 'public' | 'private';

export type CompanyKind = { [k in CompanyKindKey]?: 0 | 1 } & {
  tags?: string[];
  /** Second array key, so `$push`/`$pull` on two keys at once stays typed in the specs. */
  labels?: string[];
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
  theme?: { color?: string };
  meta?: Record<string, unknown>;
  isArchived?: boolean;
};

/**
 * `Company` will inherit all the fields (including the `Id`) declared in `BaseEntity`.
 */
@Entity()
export class Company extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ type: String })
  description?: string | null;

  @Field({ type: 'jsonb' })
  kind?: Json<CompanyKind> | null;
}

/**
 * and entity can specify the table name.
 */
@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  // Names the key for the type level: the inherited `id` would otherwise be taken for it, since a
  // conventional name outranks the fallback and nothing else says `pk` replaced it.
  [idKey]?: 'pk';

  /**
   * an entity can specify its own ID Field and still inherit the others
   * columns/relations from its parent entity.
   */
  @Id({ type: String, onInsert: uuidv7 })
  pk?: string;

  @Field({ type: String, name: 'image' })
  picture?: string | null;

  // Narrows the inherited m1 relation to 1-1. A real field rather than `declare`, because the standard
  // decorator spec has nothing to decorate on a `declare` member; the initializer marks the shadowing as
  // deliberate.
  @OneToOne({ entity: () => User, references: (profile) => profile.creatorId })
  override creator?: User = undefined;
}

@Entity()
export class User extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ type: String, updatable: false })
  email?: string | null;

  @Field({ type: String, eager: false })
  password?: string | null;

  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.creator, cascade: true })
  profile?: Profile;

  @OneToMany({ entity: () => User, mappedBy: (user) => user.creator })
  users?: User[];
}

@Entity()
export class UserWithNonUpdatableId {
  @Id({ type: Number, updatable: false })
  id!: number;

  @Field({ type: String })
  name!: string | null;
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ type: String })
  description?: string | null;

  @Field({ references: () => LedgerAccount })
  parentLedgerId?: string | null;

  @ManyToOne({ entity: () => LedgerAccount, references: (ledgerAccount) => ledgerAccount.parentLedgerId })
  parentLedger?: LedgerAccount;
}

@Entity()
export class TaxCategory extends BaseEntity {
  /**
   * `idKey` symbol can be used to specify the name of the identifier property,
   * so the type of the identifier can always be type-safe
   * (the identifiers named as `id` or `_id` are auto-inferred).
   */
  [idKey]?: 'pk';

  /**
   * an entity can override the ID Field and still inherit the others
   * columns/relations from its parent entity.
   * 'onInsert' property can be used to specify a custom mechanism for
   * auto-generating the primary-key's value when inserting.
   */
  @Id({ type: String, onInsert: randomUUID })
  pk?: string;

  @Field({ type: String })
  name?: string | null;

  @Field({ type: String })
  description?: string | null;
}

@Entity()
export class Tax extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ type: Number })
  percentage?: number | null;

  @Field({ references: () => TaxCategory })
  categoryId?: string | null;

  @ManyToOne({ entity: () => TaxCategory, references: (tax) => tax.categoryId })
  category?: TaxCategory;

  @Field({ type: String })
  description?: string | null;
}

/**
 * A `softDelete` field makes the entity "soft deletable": deletes stamp the field instead of
 * removing the row. Use `true` for the current timestamp, or a callback for a custom value.
 */
@Entity()
export class MeasureUnitCategory extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @OneToMany({ entity: () => MeasureUnit, mappedBy: (measureUnit) => measureUnit.categoryId })
  measureUnits?: MeasureUnit[];

  /** A relation aggregate, read only where a query names it, and never counting a soft-deleted unit. */
  @Field({ computed: (category) => category.measureUnits.count() })
  readonly unitCount?: number;

  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number | null;
}

@Entity()
export class MeasureUnit extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ references: () => MeasureUnitCategory })
  categoryId?: string | null;

  @ManyToOne({
    entity: () => MeasureUnitCategory,
    references: (measureUnit) => measureUnit.categoryId,
    cascade: 'persist',
  })
  category?: MeasureUnitCategory;

  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number | null;
}

@Entity()
export class Storehouse extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ type: String })
  address?: string | null;

  @Field({ type: String })
  description?: string | null;
}

@Entity()
export class Item extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @Field({ type: String })
  description?: string | null;

  @Field({ type: String })
  code?: string | null;

  @Field({ references: () => LedgerAccount })
  buyLedgerAccountId?: string | null;

  @ManyToOne({ entity: () => LedgerAccount, references: (item) => item.buyLedgerAccountId })
  buyLedgerAccount?: LedgerAccount;

  @Field({ references: () => LedgerAccount })
  saleLedgerAccountId?: string | null;

  @ManyToOne({ entity: () => LedgerAccount, references: (item) => item.saleLedgerAccountId })
  saleLedgerAccount?: LedgerAccount;

  @Field({ references: () => Tax })
  taxId?: string | null;

  @ManyToOne({ entity: () => Tax, references: (item) => item.taxId })
  tax?: Tax;

  @Field({ references: () => MeasureUnit })
  measureUnitId?: string | null;

  @ManyToOne({ entity: () => MeasureUnit, references: (item) => item.measureUnitId })
  measureUnit?: MeasureUnit;

  @Field({ type: Number })
  salePrice?: number | null;

  @Field({ type: Boolean })
  inventoryable?: boolean | null;

  @ManyToMany({ entity: () => Tag, through: () => ItemTag, cascade: true })
  tags?: Tag[];

  /**
   * An unstored relation aggregate: the subquery is spliced into each statement that reads it, so it is
   * never a column and works in `$select`, `$where` and `$sort` like any other field.
   */
  @Field({ computed: (item) => item.tags.count() })
  readonly tagsCount?: number;
}

@Entity()
export class Tag extends BaseEntity {
  @Field({ type: String })
  name?: string | null;

  @ManyToMany({ entity: () => Item, mappedBy: (item) => item.tags })
  items?: Item[];

  /** The same aggregate from the inverse side of the many-to-many, counting the junction's rows. */
  @Field({ computed: (tag) => tag.items.count() })
  readonly itemsCount?: number;
}

@Entity()
export class ItemTag {
  @Id({ type: String, onInsert: uuidv7 })
  id?: string;

  @Field({ references: () => Item })
  itemId?: string | null;

  @Field({ references: () => Tag })
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

  @Field({ type: Date })
  date?: Date | null;

  @Field({ type: String })
  description?: string | null;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @Field({ references: () => Item })
  itemId?: string | null;

  @ManyToOne({ entity: () => Item, references: (itemAdjustment) => itemAdjustment.itemId })
  item?: Item;

  @Field({ type: Number })
  number?: number | null;

  @Field({ type: Number })
  buyPrice?: number | null;

  @Field({ references: () => Storehouse })
  storehouseId?: string | null;

  @ManyToOne({ entity: () => Storehouse, references: (itemAdjustment) => itemAdjustment.storehouseId })
  storehouse?: Storehouse;

  @Field({ references: () => InventoryAdjustment })
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
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
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
  @Id({ type: Number })
  id?: number;

  @Field({ type: Number })
  amount?: number | null;

  @Field({ references: () => Invoice })
  invoiceId?: number | null;

  @ManyToOne({ entity: () => Invoice, references: (invoiceLine) => invoiceLine.invoiceId })
  invoice?: Invoice;
}

/**
 * Auto-increment PK + a separately-unique conflict column, dedicated to `upsertMany` id-return
 * tests: `code` (not the PK) is the conflict path, so a newly-inserted row's id is only knowable
 * from the database's response, never from the payload itself.
 */
@Entity()
export class Coupon {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, unique: true }) code?: string | null;
  @Field({ type: String }) label?: string | null;
}

/**
 * One column per declared JS type, for the round-trip that asserts a read gives back what the entity
 * promised. Engines disagree wildly underneath: `Number` becomes BIGINT (or DECIMAL with a scale),
 * `Boolean` becomes TINYINT(1) or a plain INTEGER, and several drivers hand every one of those back
 * as text. Three shipped bugs of that shape were found before this existed.
 */
@Entity()
export class TypedRow {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: Number }) count?: number | null;
  /** precision/scale makes this DECIMAL/NUMERIC, which pg and mysql2 both return as a string. */
  @Field({ type: Number, precision: 12, scale: 2 }) amount?: number | null;
  @Field({ type: Boolean }) enabled?: boolean | null;
  /**
   * The opt-out from that: `columnType` still makes it DECIMAL, but declaring `String` keeps it off
   * the numeric path, so a value wider than 2^53 survives as the exact text the driver returned.
   */
  @Field({ type: String, columnType: 'decimal', precision: 30, scale: 2 }) exact?: string | null;
  /** A BIGINT written from a `bigint`, which only an exact bind keeps apart from its rounded neighbour. */
  @Field({ type: BigInt }) wide?: bigint | null;
  @Field({ type: Date }) at?: Date | null;
  @Field({ type: 'blob' }) bytes?: Uint8Array | null;
  @Field({ references: () => TypedGroup }) groupId?: number | null;
  @ManyToOne({ entity: () => TypedGroup, references: (typedRow) => typedRow.groupId }) group?: TypedGroup;
}

/** Holds {@link TypedRow}s, so a populated row can be read back beside a read of its own. */
@Entity()
export class TypedGroup {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @OneToMany({ entity: () => TypedRow, mappedBy: (typedRow) => typedRow.group }) rows?: TypedRow[];
}

@Entity()
export class VectorItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: 'vector', dimensions: 3 }) vec!: number[] | null;
}

/**
 * A document, its chunks and the chunks it cites, every one with a vector named `vec`: a join tells
 * them apart by alias only, and a relation sort ranks a document by its nearest chunk.
 */
@Entity()
export class VectorDoc {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ type: String }) name?: string | null;
  @Field({ type: 'vector', dimensions: 3 }) vec?: number[] | null;
  @OneToMany({ entity: () => VectorChunk, mappedBy: (chunk) => chunk.doc }) chunks?: VectorChunk[];
  @ManyToMany({ entity: () => VectorChunk, through: () => VectorCitation }) cited?: VectorChunk[];
  /** A column of a many-to-many's targets, which a junction row does not carry. */
  @Field({ computed: (doc) => doc.cited.max((chunk) => chunk.name) }) readonly lastCited?: string | null;
}

@Entity()
export class VectorChunk {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ type: String }) name?: string | null;
  @Field({ type: 'vector', dimensions: 3 }) vec?: number[] | null;
  @Field({ references: () => VectorDoc }) vectorDocId?: string | null;
  @ManyToOne({ entity: () => VectorDoc, references: (chunk) => chunk.vectorDocId }) doc?: VectorDoc;
}

@Entity()
export class VectorCitation {
  @Id({ type: String, onInsert: uuidv7 }) id?: string;
  @Field({ references: () => VectorDoc }) vectorDocId?: string | null;
  @Field({ references: () => VectorChunk }) vectorChunkId?: string | null;
}

/**
 * pgvector's narrower vector types, which every other dialect maps onto the one it has. Their point
 * here is the round-trip: `halfvec` and `sparsevec` used to bind as plain arrays on insert, and
 * `sparsevec` rejects the dense literal the others take, both invisible to a SQL-text assertion.
 */
@Entity()
export class NarrowVectorItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: 'halfvec', dimensions: 3 }) half!: number[] | null;
  @Field({ type: 'sparsevec', dimensions: 3 }) sparse!: number[] | null;
}

/**
 * A JSON array column, dedicated to the dialect specs for the JSON array operators
 * (`$all`/`$size`/`$elemMatch`). The `unknown[]` element type keeps keys and values unchecked so
 * the specs can exercise arbitrary shapes against the generated SQL.
 */
@Entity()
export class JsonRecord {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) entries?: Json<unknown[]> | null;
}
