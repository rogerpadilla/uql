import { randomUUID } from 'node:crypto';
import { Entity, Field, Id, ManyToMany, ManyToOne, OneToMany, OneToOne } from '../entity/index.js';
import { idKey, type Json } from '../type/index.js';
import { raw } from '../util/index.js';

/**
 * an `abstract` class can (optionally) be used as the base "template" for the entities
 * (so common fields' declaration is easily reused).
 */
export abstract class BaseEntity {
  /**
   * auto-generated primary-key (when the `onInsert` property is omitted).
   */
  @Id({ type: Number })
  id?: number;

  /**
   * foreign-keys are really simple to specify with the `references` property.
   */
  @Field({ references: () => Company })
  companyId?: number;

  @ManyToOne({ entity: () => Company })
  company?: Company;

  @Field({ references: () => User })
  creatorId?: number;

  @ManyToOne({ entity: () => User })
  creator?: User;

  /**
   * 'onInsert' property can be used to specify a custom mechanism for
   * obtaining the value of a field when inserting:
   */
  @Field({ type: Number, onInsert: Date.now })
  createdAt?: number;

  /**
   * 'onUpdate' property can be used to specify a custom mechanism for
   * obtaining the value of a field when updating:
   */
  @Field({ type: Number, onUpdate: Date.now })
  updatedAt?: number;
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
  name?: string;

  @Field({ type: String })
  description?: string;

  @Field({ type: 'jsonb' })
  kind?: Json<CompanyKind>;
}

/**
 * and entity can specify the table name.
 */
@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  /**
   * an entity can specify its own ID Field and still inherit the others
   * columns/relations from its parent entity.
   */
  @Id({ type: Number })
  pk?: number;

  @Field({ type: String, name: 'image' })
  picture?: string;

  // Narrows the inherited m1 relation to 1-1. A real field rather than `declare`, because the standard
  // decorator spec has nothing to decorate on a `declare` member; the initializer marks the shadowing as
  // deliberate.
  @OneToOne({ entity: () => User })
  override creator?: User = undefined;
}

@Entity()
export class User extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @Field({ type: String, updatable: false })
  email?: string;

  @Field({ type: String, eager: false })
  password?: string;

  /**
   * `mappedBy` property can be a callback or a string (callback is useful for auto-refactoring).
   */
  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.creator, cascade: true })
  profile?: Profile;

  @OneToMany({ entity: () => User, mappedBy: 'creator' })
  users?: User[];
}

@Entity()
export class UserWithNonUpdatableId {
  @Id({ type: Number, updatable: false })
  id!: number;

  @Field({ type: String })
  name!: string;
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @Field({ type: String })
  description?: string;

  @Field({ references: () => LedgerAccount })
  parentLedgerId?: number;

  @ManyToOne({ entity: () => LedgerAccount })
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
  name?: string;

  @Field({ type: String })
  description?: string;
}

@Entity()
export class Tax extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @Field({ type: Number })
  percentage?: number;

  @Field({ references: () => TaxCategory })
  categoryId?: string;

  @ManyToOne({ entity: () => TaxCategory })
  category?: TaxCategory;

  @Field({ type: String })
  description?: string;
}

/**
 * A `softDelete` field makes the entity "soft deletable": deletes stamp the field instead of
 * removing the row. Use `true` for the current timestamp, or a callback for a custom value.
 */
@Entity()
export class MeasureUnitCategory extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @OneToMany({ entity: () => MeasureUnit, mappedBy: (measureUnit) => measureUnit.categoryId })
  measureUnits?: MeasureUnit[];

  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number;
}

@Entity()
export class MeasureUnit extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @Field({ references: () => MeasureUnitCategory })
  categoryId?: number;

  @ManyToOne({ entity: () => MeasureUnitCategory, cascade: 'persist' })
  category?: MeasureUnitCategory;

  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number;
}

@Entity()
export class Storehouse extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @Field({ type: String })
  address?: string;

  @Field({ type: String })
  description?: string;
}

@Entity()
export class Item extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @Field({ type: String })
  description?: string;

  @Field({ type: String })
  code?: string;

  @Field({ references: () => LedgerAccount })
  buyLedgerAccountId?: number;

  @ManyToOne({ entity: () => LedgerAccount })
  buyLedgerAccount?: LedgerAccount;

  @Field({ references: () => LedgerAccount })
  saleLedgerAccountId?: number;

  @ManyToOne({ entity: () => LedgerAccount })
  saleLedgerAccount?: LedgerAccount;

  @Field({ references: () => Tax })
  taxId?: number;

  @ManyToOne({ entity: () => Tax })
  tax?: Tax;

  @Field({ references: () => MeasureUnit })
  measureUnitId?: number;

  @ManyToOne({ entity: () => MeasureUnit })
  measureUnit?: MeasureUnit;

  @Field({ type: Number })
  salePrice?: number;

  @Field({ type: Boolean })
  inventoryable?: boolean;

  @ManyToMany({ entity: () => Tag, through: () => ItemTag, cascade: true })
  tags?: Tag[];

  @Field({
    /**
     * `virtual` property allows defining the value for a non-persistent field,
     * such value might be a scalar or a (`raw`) function. Virtual-fields can
     * be used in `$select` and `$where` as a common field whose value is
     * replaced is replaced at runtime.
     */
    type: Number,
    virtual: raw(({ ctx, escapedPrefix, dialect }) => {
      ctx.append('(');
      dialect.count(
        ctx,
        ItemTag,
        {
          $where: {
            itemId: raw(({ ctx: innerCtx }) => {
              innerCtx.append(escapedPrefix + dialect.escapeId('id'));
            }),
          },
        },
        { autoPrefix: true },
      );
      ctx.append(')');
    }),
  })
  tagsCount?: number;
}

@Entity()
export class Tag extends BaseEntity {
  @Field({ type: String })
  name?: string;

  @ManyToMany({ entity: () => Item, mappedBy: (item) => item.tags })
  items?: Item[];

  @Field({
    type: Number,
    virtual: raw(({ ctx, escapedPrefix, dialect }) => {
      ctx.append('(');
      dialect.count(
        ctx,
        ItemTag,
        {
          $where: {
            tagId: raw(({ ctx: innerCtx }) => {
              innerCtx.append(escapedPrefix + dialect.escapeId('id'));
            }),
          },
        },
        { autoPrefix: true },
      );
      ctx.append(')');
    }),
  })
  itemsCount?: number;
}

@Entity()
export class ItemTag {
  @Id({ type: Number })
  id?: number;

  @Field({ references: () => Item })
  itemId?: number;

  @Field({ references: () => Tag })
  tagId?: number;
}

@Entity()
export class InventoryAdjustment extends BaseEntity {
  @OneToMany({
    entity: () => ItemAdjustment,
    mappedBy: (rel) => rel.inventoryAdjustment,
    cascade: true,
  })
  itemAdjustments?: ItemAdjustment[];

  @Field({ type: Date })
  date?: Date;

  @Field({ type: String })
  description?: string;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @Field({ references: () => Item })
  itemId?: number;

  @ManyToOne({ entity: () => Item })
  item?: Item;

  @Field({ type: Number })
  number?: number;

  @Field({ type: Number })
  buyPrice?: number;

  @Field({ references: () => Storehouse })
  storehouseId?: number;

  @ManyToOne({ entity: () => Storehouse })
  storehouse?: Storehouse;

  @Field({ references: () => InventoryAdjustment })
  inventoryAdjustmentId?: number;

  @ManyToOne({ entity: () => InventoryAdjustment })
  inventoryAdjustment?: InventoryAdjustment;
}

/**
 * Auto-increment PK + a separately-unique conflict column, dedicated to `upsertMany` id-return
 * tests: `code` (not the PK) is the conflict path, so a newly-inserted row's id is only knowable
 * from the database's response, never from the payload itself.
 */
@Entity()
export class Coupon {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, unique: true }) code?: string;
  @Field({ type: String }) label?: string;
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
  @Field({ type: String }) name?: string;
  @Field({ type: Number }) count?: number;
  /** precision/scale makes this DECIMAL/NUMERIC, which pg and mysql2 both return as a string. */
  @Field({ type: Number, precision: 12, scale: 2 }) amount?: number;
  @Field({ type: Boolean }) enabled?: boolean;
  /**
   * The opt-out from that: `columnType` still makes it DECIMAL, but declaring `String` keeps it off
   * the numeric path, so a value wider than 2^53 survives as the exact text the driver returned.
   */
  @Field({ type: String, columnType: 'decimal', precision: 30, scale: 2 }) exact?: string;
}

@Entity()
export class VectorItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @Field({ type: 'vector', dimensions: 3 }) vec!: number[];
}

/**
 * pgvector's narrower vector types, which every other dialect maps onto the one it has. Their point
 * here is the round-trip: `halfvec` and `sparsevec` used to bind as plain arrays on insert, and
 * `sparsevec` rejects the dense literal the others take, both invisible to a SQL-text assertion.
 */
@Entity()
export class NarrowVectorItem {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @Field({ type: 'halfvec', dimensions: 3 }) half!: number[];
  @Field({ type: 'sparsevec', dimensions: 3 }) sparse!: number[];
}

/**
 * A JSON array column, dedicated to the dialect specs for the JSON array operators
 * (`$all`/`$size`/`$elemMatch`). The `unknown[]` element type keeps keys and values unchecked so
 * the specs can exercise arbitrary shapes against the generated SQL.
 */
@Entity()
export class JsonRecord {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'json' }) entries?: Json<unknown[]>;
}
