import { v4 as uuidv4 } from 'uuid';
import { Field, ManyToOne, Id, OneToMany, Entity, OneToOne, ManyToMany } from '@uql/core/entity';
import { raw } from '@uql/core/util';
import { idType } from '../type';

/**
 * interfaces can (optionally) be used to avoid circular-reference issue between entities.
 */
export interface IEntity {
  id?: number;
  companyId?: number;
  company?: ICompany;
  creatorId?: number;
  creator?: IUser;
  createdAt?: number;
  updatedAt?: number;
}

interface ICompany extends IEntity {
  name?: string;
  description?: string;
}

interface IUser extends IEntity {
  name?: string;
  email?: string;
  password?: string;
  profile?: Profile;
}

/**
 * an abstract class can (optionally) be used as a "template" for the entities
 * (so the common attributes' declaration is reused).
 */
export abstract class BaseEntity implements IEntity {
  @Id()
  id?: number;
  /**
   * foreign-keys are really simple to specify
   */
  @Field({ reference: () => Company })
  companyId?: number;
  @ManyToOne({ entity: () => Company })
  company?: ICompany;
  @Field({ reference: () => User })
  creatorId?: number;
  @ManyToOne({ entity: () => User })
  creator?: IUser;
  /**
   * 'onInsert' callback can be used to specify a custom mechanism for
   * obtaining the value of a field when inserting:
   */
  @Field({ onInsert: Date.now })
  createdAt?: number;
  /**
   * 'onUpdate' callback can be used to specify a custom mechanism for
   * obtaining the value of a field when updating:
   */
  @Field({ onUpdate: Date.now })
  updatedAt?: number;
}

/**
 * `Company` will inherit all the fields (including the `Id`) declared in `BaseEntity`.
 */
@Entity()
export class Company extends BaseEntity implements ICompany {
  @Field()
  name?: string;
  @Field()
  description?: string;
}

/**
 * and entity can specify the table name
 */
@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  /**
   * an entity can specify its own ID Field and still inherit the others
   * columns/relations from its parent entity.
   * 'onInsert' callback can be used to specify a custom mechanism for
   * auto-generating the primary-key's value when inserting.
   */
  @Id({ name: 'pk' })
  id?: number;
  @Field({ name: 'image' })
  picture?: string;
  @OneToOne({ entity: () => User })
  creator?: IUser;
}

@Entity()
export class User extends BaseEntity implements IUser {
  @Field()
  name?: string;
  @Field()
  email?: string;
  @Field()
  password?: string;
  /**
   * `mappedBy` can be a callback or a string (callback is useful for auto-refactoring).
   */
  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.creator, cascade: true })
  profile?: Profile;
  @OneToMany({ entity: () => User, mappedBy: 'creator' })
  users?: User[];
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Field()
  name?: string;
  @Field()
  description?: string;
  @Field({ reference: () => LedgerAccount })
  parentLedgerId?: number;
  @ManyToOne()
  parentLedger?: LedgerAccount;
}

@Entity()
export class TaxCategory extends BaseEntity {
  /**
   * `idType` symbol can be used to specify the type of the identifier property
   * so the type of the identifier can always be type-safe
   * (the type of identifiers named as `id` or `_id` is auto-inferred).
   */
  [idType]?: string;
  /**
   * an entity can specify its own ID Field and still inherit the others
   * columns/relations from its parent entity.
   * 'onInsert' callback can be used to specify a custom mechanism for
   * auto-generating the primary-key's value when inserting.
   */
  @Id({ onInsert: () => uuidv4() })
  pk?: string;
  @Field()
  name?: string;
  @Field()
  description?: string;
}

@Entity()
export class Tax extends BaseEntity {
  @Field()
  name?: string;
  @Field()
  percentage?: number;
  @Field({ reference: () => TaxCategory })
  categoryId?: string;
  @ManyToOne()
  category?: TaxCategory;
  @Field()
  description?: string;
}

/**
 * `softDelete` will make the entity "soft deletable".
 */
@Entity({ softDelete: true })
export class MeasureUnitCategory extends BaseEntity {
  @Field()
  name?: string;
  @OneToMany({ entity: () => MeasureUnit, mappedBy: (measureUnit) => measureUnit.category })
  measureUnits?: MeasureUnit[];
  /**
   * `onDelete` callback allows to specify which field will be used when deleting/querying this entity.
   */
  @Field({ onDelete: Date.now })
  deletedAt?: number;
}

@Entity({ softDelete: true })
export class MeasureUnit extends BaseEntity {
  @Field()
  name?: string;
  @Field({ reference: () => MeasureUnitCategory })
  categoryId?: number;
  @ManyToOne({ cascade: 'persist' })
  category?: MeasureUnitCategory;
  @Field({ onDelete: Date.now })
  deletedAt?: number;
}

@Entity()
export class Storehouse extends BaseEntity {
  @Field()
  name?: string;
  @Field()
  address?: string;
  @Field()
  description?: string;
}

@Entity()
export class Item extends BaseEntity {
  @Field()
  name?: string;
  @Field()
  description?: string;
  @Field()
  code?: string;
  @Field({ reference: () => LedgerAccount })
  buyLedgerAccountId?: number;
  @ManyToOne()
  buyLedgerAccount?: LedgerAccount;
  @Field({ reference: () => LedgerAccount })
  saleLedgerAccountId?: number;
  @ManyToOne()
  saleLedgerAccount?: LedgerAccount;
  @Field({ reference: { entity: () => Tax } })
  taxId?: number;
  @ManyToOne()
  tax?: Tax;
  @Field({ reference: () => MeasureUnit })
  measureUnitId?: number;
  @ManyToOne()
  measureUnit?: MeasureUnit;
  @Field()
  salePrice?: number;
  @Field()
  inventoryable?: boolean;
  @ManyToMany({ entity: () => Tag, through: () => ItemTag, cascade: true })
  tags?: Tag[];
  @Field({
    /**
     * `virtual` property allows defining the value for a non-persistent field,
     * such value might be a scalar or a (`raw`) function. Virtual-fields can be
     * used in `$project`, `$filter` and `$having` as a common field whose value
     * is replaced at runtime.
     */
    virtual: raw(({ escapedPrefix, dialect }) => {
      const query = dialect.count(
        ItemTag,
        {
          $filter: {
            itemId: raw(`${escapedPrefix}${dialect.escapeId('id')}`),
          },
        },
        { autoPrefix: true }
      );
      return `(${query})`;
    }),
  })
  tagsCount?: number;
}

@Entity()
export class Tag extends BaseEntity {
  @Field()
  name?: string;
  @ManyToMany({ entity: () => Item, mappedBy: (item) => item.tags })
  items?: Item[];
  @Field({
    virtual: raw(({ escapedPrefix, dialect }) => {
      /**
       * `virtual` property allows defining the value for a non-persistent field,
       * such value might be a scalar or a (`raw`) function. Virtual-fields can be
       * used in `$project`, `$filter` and `$having` as a common field whose value
       * is replaced at runtime.
       */
      const query = dialect.count(
        ItemTag,
        {
          $filter: {
            tagId: raw(`${escapedPrefix}${dialect.escapeId('id')}`),
          },
        },
        { autoPrefix: true }
      );
      return `(${query})`;
    }),
  })
  itemsCount?: number;
}

@Entity()
export class ItemTag {
  @Id()
  id?: number;
  @Field({ reference: () => Item })
  itemId?: number;
  @Field({ reference: () => Tag })
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
  @Field()
  date?: Date;
  @Field()
  description?: string;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @Field({ reference: () => Item })
  itemId?: number;
  @ManyToOne()
  item?: Item;
  @Field()
  number?: number;
  @Field()
  buyPrice?: number;
  @Field({ reference: () => Storehouse })
  storehouseId?: number;
  @ManyToOne()
  storehouse?: Storehouse;
  @Field({ reference: () => InventoryAdjustment })
  inventoryAdjustmentId?: number;
  @ManyToOne()
  inventoryAdjustment?: InventoryAdjustment;
}
