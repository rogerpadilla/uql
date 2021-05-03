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
  @Property({ reference: { type: () => Company } })
  companyId?: string;
  @ManyToOne({ type: () => Company })
  company?: ICompany;
  @Property({ reference: { type: () => User } })
  userId?: string;
  @ManyToOne({ type: () => User })
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
}

@Entity()
export class User extends BaseEntity implements IUser {
  @Property()
  name?: string;
  @Property()
  email?: string;
  @Property()
  password?: string;
  @OneToOne({ mappedBy: 'userId' })
  profile?: Profile;
  @OneToMany({ type: () => User, mappedBy: 'userId' })
  users?: User[];
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  description?: string;
  @Property({ reference: { type: () => LedgerAccount } })
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
  @Property({ reference: { type: () => TaxCategory } })
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
  @Property({ reference: { type: () => MeasureUnitCategory } })
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
  @ManyToMany({ type: () => Item })
  items: Item[];
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
  @Property({ reference: { type: () => LedgerAccount } })
  buyLedgerAccountId?: string;
  @ManyToOne()
  buyLedgerAccount?: LedgerAccount;
  @Property({ reference: { type: () => LedgerAccount } })
  saleLedgerAccountId?: string;
  @ManyToOne()
  saleLedgerAccount?: LedgerAccount;
  @Property({ reference: { type: () => Tax } })
  taxId?: string;
  @ManyToOne()
  tax?: Tax;
  @Property({ reference: { type: () => MeasureUnit } })
  measureUnitId?: string;
  @ManyToOne()
  measureUnit?: MeasureUnit;
  @Property()
  buyPriceAverage?: number;
  @Property()
  salePrice?: number;
  @Property()
  inventoryable?: boolean;
  @ManyToMany({ type: () => Tag })
  tags?: Tag[];
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @ManyToOne()
  item?: Item;
  @Property()
  number?: number;
  @Property()
  buyPrice?: number;
  @Property({ reference: { type: () => Storehouse } })
  storehouseId?: string;
  @ManyToOne()
  storehouse?: Storehouse;
  @Property({ reference: { type: () => InventoryAdjustment } })
  inventoryAdjustmentId?: string;
}

@Entity()
export class InventoryAdjustment extends BaseEntity {
  @OneToMany({ type: () => ItemAdjustment, mappedBy: 'inventoryAdjustmentId' })
  itemAdjustments?: ItemAdjustment[];
  @Property()
  date?: number;
  @Property()
  description?: string;
}
