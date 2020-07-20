import { Column, ManyToOne, PrimaryColumn, OneToMany, Entity, OneToOne } from './decorator';

export abstract class BaseEntity {
  @PrimaryColumn()
  id?: number;
  @ManyToOne({ type: () => Company })
  @Column({ mode: 'insert' })
  company?: number | Company;
  @Column({ mode: 'insert' })
  @ManyToOne({ type: () => User })
  user?: number | User;
  @Column({ mode: 'insert' })
  createdAt?: number;
  @Column({ mode: 'update' })
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
  @PrimaryColumn({ name: 'pk' })
  id?: number;
  @Column({ name: 'image' })
  picture?: string;
}

@Entity({ name: 'user' })
export class User extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  email?: string;
  @Column()
  password?: string;
  @OneToOne({ mappedBy: 'user' })
  @Column()
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
  @PrimaryColumn()
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
  @Column()
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
  @Column()
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
  @Column()
  buyLedgerAccount?: LedgerAccount;
  @ManyToOne()
  @Column()
  saleLedgerAccount?: LedgerAccount;
  @ManyToOne()
  @Column()
  tax?: Tax;
  @ManyToOne()
  @Column()
  measureUnit?: MeasureUnit;
  @Column({ mode: 'read' })
  buyPriceAverage?: number;
  @Column()
  salePrice?: number;
  @Column()
  inventoryable?: boolean;
}

@Entity()
export class ItemAdjustment extends BaseEntity {
  @ManyToOne()
  @Column()
  item?: Item;
  @Column()
  number?: number;
  @Column()
  buyPrice?: number;
  @ManyToOne()
  @Column()
  storehouse?: Storehouse;
  @Column({ mode: 'insert' })
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
