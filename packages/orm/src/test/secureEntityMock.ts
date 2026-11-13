import { Entity, f, Field, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';
import { $context } from '../util/contextRefs.js';

declare module '../type/index.js' {
  interface UqlContext {
    secureTenantId?: number;
  }
}

/** The joined (m1) side of a policy, which a JOIN or a populate applies as a read does. */
@Entity({ policies: [{ must: { tenantId: $context.secureTenantId } }, { allow: {} }] })
export class SecureRelated {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.number().nullable())
  tenantId?: number | null;
  @Field(f.string().nullable())
  name?: string | null;
}

@Entity()
export class SecureParent {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.references(() => SecureRelated).nullable())
  relatedId?: number | null;
  @ManyToOne(() => SecureRelated, { references: (secureParent) => secureParent.relatedId })
  related?: SecureRelated;
}

/** The relation-subquery target: a policy and a soft-delete field must both scope it. */
@Entity({ policies: [{ must: { tenantId: $context.secureTenantId } }, { allow: {} }] })
export class SecureChild {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.number().nullable())
  tenantId?: number | null;
  @Field(f.references(() => SecureCollection).nullable())
  collectionId?: number | null;
  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedAt?: number | null;
  @ManyToOne(() => SecureCollection, { references: (secureChild) => secureChild.collectionId })
  collection?: SecureCollection;
}

/** No filters of its own, so a count over the junction to it stays junction-only. */
@Entity()
export class PlainChild {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  collectionId?: number | null;
  @ManyToOne(() => SecureCollection, { references: (plainChild) => plainChild.collectionId })
  collection?: SecureCollection;
}

/** A many-to-many's junction: each side joins by the one column referencing it. */
@Entity()
class SecureCollectionChild {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  secureCollectionId?: number | null;
  @Field(f.references(() => SecureChild).nullable())
  secureChildId?: number | null;
}

@Entity()
class SecureCollectionPlain {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  secureCollectionId?: number | null;
  @Field(f.references(() => PlainChild).nullable())
  plainChildId?: number | null;
}

/** Junction whose FK columns are renamed, so the mm form has to resolve them too. */
@Entity()
class SecureCollectionRenamed {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(
    f
      .references(() => SecureCollection)
      .nullable()
      .name('renamed_collection'),
  )
  secureCollectionId?: number | null;
  @Field(
    f
      .references(() => SecureChild)
      .nullable()
      .name('renamed_child'),
  )
  secureChildId?: number | null;
}

/** A soft-deletable junction: an unlinked row must not count as a link. */
@Entity()
class SecureCollectionLink {
  @Field(f.number().autoIncrement())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  secureCollectionId?: number | null;
  @Field(f.references(() => PlainChild).nullable())
  plainChildId?: number | null;
  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedAt?: number | null;
}

@Entity()
export class SecureCollection {
  @Field(f.number().autoIncrement())
  id?: number;
  @OneToMany(() => SecureChild, { mappedBy: (secureChild) => secureChild.collectionId })
  children?: SecureChild[];
  @ManyToMany(() => SecureChild, { through: () => SecureCollectionChild })
  taggedChildren?: SecureChild[];
  @ManyToMany(() => PlainChild, { through: () => SecureCollectionPlain })
  plainChildren?: PlainChild[];
  @ManyToMany(() => PlainChild, { through: () => SecureCollectionLink })
  linkedChildren?: PlainChild[];
  @ManyToMany(() => SecureChild, { through: () => SecureCollectionRenamed })
  renamedChildren?: SecureChild[];
}
