import { v4 as uuidv4 } from 'uuid';
import { Property, ManyToOne, Id, OneToMany, Entity, OneToOne, ManyToMany } from '../entity/decorator';

export interface IEntity {
  id?: string;
  companyId?: string;
  company?: ICompany;
  userId?: string;
  user?: IUser;
  createdAt?: number;
  updatedAt?: number;
  status?: number;
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

export abstract class BaseEntity implements IEntity {
  @Id()
  id?: string;
  @Property({ reference: () => Company })
  companyId?: string;
  @ManyToOne({ entity: () => Company })
  company?: ICompany;
  @Property({ reference: () => User })
  userId?: string;
  @ManyToOne({ entity: () => User })
  user?: IUser;
  @Property({ onInsert: () => Date.now() })
  createdAt?: number;
  @Property({ onUpdate: () => Date.now() })
  updatedAt?: number;
  @Property()
  status?: number;
}

@Entity()
export class Company extends BaseEntity implements ICompany {
  @Property()
  name?: string;
  @Property()
  description?: string;
}

@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  @Id({ name: 'pk' })
  id?: string;
  @Property({ name: 'image' })
  picture?: string;
  @OneToOne({ entity: () => User })
  user?: IUser;
}

@Entity()
export class User extends BaseEntity implements IUser {
  @Property()
  name?: string;
  @Property()
  email?: string;
  @Property()
  password?: string;
  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.user })
  profile?: Profile;
  @OneToMany({ entity: () => User, mappedBy: 'user' })
  users?: User[];
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  description?: string;
  @Property({ reference: () => LedgerAccount })
  parentLedgerId?: string;
  @ManyToOne()
  parentLedger?: LedgerAccount;
}

@Entity()
export class TaxCategory extends BaseEntity {
  @Id({ onInsert: () => uuidv4() })
  pk?: string;
  @Property()
  name?: string;
  @Property()
  description?: string;
}

@Entity()
export class Tax extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  percentage?: number;
  @Property({ reference: () => TaxCategory })
  categoryId?: string;
  @ManyToOne()
  category?: TaxCategory;
  @Property()
  description?: string;
}

@Entity()
export class MeasureUnitCategory extends BaseEntity {
  @Property()
  name?: string;
}

@Entity()
export class MeasureUnit extends BaseEntity {
  @Property()
  name?: string;
  @Property({ reference: () => MeasureUnitCategory })
  categoryId?: string;
  @ManyToOne()
  category?: MeasureUnitCategory;
}

@Entity()
export class Storehouse extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  address?: string;
  @Property()
  description?: string;
}

@Entity()
export class Tag extends BaseEntity {
  @Property()
  name?: string;
  @ManyToMany({ entity: () => Item, mappedBy: (item) => item.tags })
  items?: Item[];
}

@Entity()
export class ItemTag {
  @Id()
  id?: string;
  @Property()
  itemId?: string;
  @Property()
  tagId?: string;
}

@Entity()
export class Item extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  description?: string;
  @Property()
  code?: string;
  @Property()
  barcode?: string;
  @Property()
  image?: string;
  @Property({ reference: () => LedgerAccount })
  buyLedgerAccountId?: string;
  @ManyToOne()
  buyLedgerAccount?: LedgerAccount;
  @Property({ reference: () => LedgerAccount })
  saleLedgerAccountId?: string;
  @ManyToOne()
  saleLedgerAccount?: LedgerAccount;
  @Property({ reference: { entity: () => Tax } })
  taxId?: string;
  @ManyToOne()
  tax?: Tax;
  @Property({ reference: () => MeasureUnit })
  measureUnitId?: string;
  @ManyToOne()
  measureUnit?: MeasureUnit;
  @Property()
  buyPriceAverage?: number;
  @Property()
  salePrice?: number;
  @Property()
  inventoryable?: boolean;
  @ManyToMany({ entity: () => Tag, through: () => ItemTag })
  tags?: Tag[];
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @Property({ reference: () => Item })
  itemId?: string;
  @ManyToOne()
  item?: Item;
  @Property()
  number?: number;
  @Property()
  buyPrice?: number;
  @Property({ reference: () => Storehouse })
  storehouseId?: string;
  @ManyToOne()
  storehouse?: Storehouse;
  @Property({ reference: () => InventoryAdjustment })
  inventoryAdjustmentId?: string;
}

@Entity()
export class InventoryAdjustment extends BaseEntity {
  @OneToMany({
    entity: () => ItemAdjustment,
    mappedBy: (rel) => rel.inventoryAdjustmentId,
  })
  itemAdjustments?: ItemAdjustment[];
  @Property()
  date?: number;
  @Property()
  description?: string;
}
