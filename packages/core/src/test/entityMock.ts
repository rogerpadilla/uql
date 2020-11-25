import { v4 as uuidv4 } from 'uuid';
import { Property, ManyToOne, Id, OneToMany, Entity, OneToOne } from '../entity/decorator';

export abstract class BaseEntity<ID = any> {
  @Id()
  id?: ID;
  @ManyToOne({ type: () => Company })
  company?: string | Company;
  @ManyToOne({ type: () => User })
  user?: string | User;
  @Property({ onInsert: () => Date.now() })
  createdAt?: number;
  @Property({ onUpdate: () => Date.now() })
  updatedAt?: number;
  @Property()
  status?: number;
}

@Entity()
export class Company extends BaseEntity {
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
export class User extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  email?: string;
  @Property()
  password?: string;
  @OneToOne({ mappedBy: 'user' })
  profile?: Profile;
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Property()
  name?: string;
  @Property()
  description?: string;
  @Property()
  parent?: string;
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
  @ManyToOne()
  buyLedgerAccount?: LedgerAccount;
  @ManyToOne()
  saleLedgerAccount?: LedgerAccount;
  @ManyToOne()
  tax?: Tax;
  @ManyToOne()
  measureUnit?: MeasureUnit;
  @Property()
  buyPriceAverage?: number;
  @Property()
  salePrice?: number;
  @Property()
  inventoryable?: boolean;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @ManyToOne()
  item?: Item;
  @Property()
  number?: number;
  @Property()
  buyPrice?: number;
  @ManyToOne()
  storehouse?: Storehouse;
  @Property()
  @ManyToOne({ type: () => InventoryAdjustment })
  inventoryAdjustment?: string;
}

@Entity()
export class InventoryAdjustment extends BaseEntity {
  @OneToMany({ type: () => ItemAdjustment, mappedBy: 'inventoryAdjustment' })
  itemsAdjustments?: ItemAdjustment[];
  @Property()
  date?: number;
  @Property()
  description?: string;
}
