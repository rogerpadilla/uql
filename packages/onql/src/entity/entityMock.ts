import { v4 as uuidv4 } from 'uuid';
import { Column, ManyToOne, IdColumn, OneToMany, Entity, OneToOne } from './decorator';

export abstract class BaseEntity {
  @IdColumn()
  id?: number;
  @ManyToOne({ type: () => Company })
  company?: number | Company;
  @ManyToOne({ type: () => User })
  user?: number | User;
  @Column({ onInsert: () => Date.now() })
  createdAt?: number;
  @Column({ onUpdate: () => Date.now() })
  updatedAt?: number;
  @Column()
  status?: number;
}

@Entity()
export class Company extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
}

@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  @IdColumn({ name: 'pk' })
  id?: number;
  @Column({ name: 'image' })
  picture?: string;
}

@Entity()
export class User extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  email?: string;
  @Column()
  password?: string;
  @OneToOne({ mappedBy: 'user' })
  profile?: Profile;
}

@Entity()
export class LedgerAccount extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
  @Column()
  parent?: number;
}

@Entity()
export class TaxCategory extends BaseEntity {
  @IdColumn({ onInsert: () => uuidv4() })
  pk?: string;
  @Column()
  name?: string;
  @Column()
  description?: string;
}

@Entity()
export class Tax extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  percentage?: number;
  @ManyToOne()
  category?: TaxCategory;
  @Column()
  description?: string;
}

@Entity()
export class MeasureUnitCategory extends BaseEntity {
  @Column()
  name?: string;
}

@Entity()
export class MeasureUnit extends BaseEntity {
  @Column()
  name?: string;
  @ManyToOne()
  category?: MeasureUnitCategory;
}

@Entity()
export class Storehouse extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  address?: string;
  @Column()
  description?: string;
}

@Entity()
export class Item extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
  @Column()
  code?: string;
  @Column()
  barcode?: string;
  @Column()
  image?: string;
  @ManyToOne()
  buyLedgerAccount?: LedgerAccount;
  @ManyToOne()
  saleLedgerAccount?: LedgerAccount;
  @ManyToOne()
  tax?: Tax;
  @ManyToOne()
  measureUnit?: MeasureUnit;
  @Column()
  buyPriceAverage?: number;
  @Column()
  salePrice?: number;
  @Column()
  inventoryable?: boolean;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @ManyToOne()
  item?: Item;
  @Column()
  number?: number;
  @Column()
  buyPrice?: number;
  @ManyToOne()
  storehouse?: Storehouse;
  @Column()
  inventoryAdjustment?: boolean;
}

@Entity()
export class InventoryAdjustment extends BaseEntity {
  @OneToMany({ type: () => ItemAdjustment, mappedBy: 'inventoryAdjustment' })
  itemsAdjustments?: ItemAdjustment[];
  @Column()
  date?: number;
  @Column()
  description?: string;
}
