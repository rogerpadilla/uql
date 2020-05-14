import { Column, ManyToOne, PrimaryColumn, OneToMany } from './decorator';

export abstract class BaseEntity {
  @PrimaryColumn()
  id?: number;
  @ManyToOne({ type: () => Company })
  @Column({ mode: 'insert' })
  company?: number;
  @ManyToOne({ type: () => User })
  @Column({ mode: 'insert' })
  user?: number | User;
  @Column({ mode: 'insert' })
  createdAt?: number;
  @Column({ mode: 'update' })
  updatedAt?: number;
  @Column()
  status?: number;
}

export class Company extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
}

export class User extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  email?: string;
  @Column()
  password?: string;
}

export class LedgerAccount extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
  @Column()
  parent?: number;
}

export class TaxCategory extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
}

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

export class MeasureUnitCategory extends BaseEntity {
  @Column()
  name?: string;
}

export class MeasureUnit extends BaseEntity {
  @Column()
  name?: string;
  @ManyToOne()
  @Column()
  category?: MeasureUnitCategory;
}

export class Storehouse extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  address?: string;
  @Column()
  description?: string;
}

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
  @ManyToOne({ type: () => InventoryAdjustment })
  @Column({ mode: 'insert' })
  inventoryAdjustment?: number;
}

export class InventoryAdjustment extends BaseEntity {
  @OneToMany({ type: () => ItemAdjustment, mappedBy: 'inventoryAdjustment' })
  itemsAdjustments?: ItemAdjustment[];
  @Column()
  date?: number;
  @Column()
  description?: string;
}
