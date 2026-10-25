import { Entity, f, Field, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';

declare module '../type/index.js' {
  interface UqlContext {
    secureTenantId?: number;
  }
}

/** The joined (m1) side of a `security: true` filter, which a JOIN or a populate applies as a read does. */
@Entity({
  filters: {
    tenant: {
      where: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
      security: true,
    },
  },
})
export class SecureRelated {
  @Field(f.number().id())
  id?: number;
  @Field(f.number().nullable())
  tenantId?: number | null;
  @Field(f.string().nullable())
  name?: string | null;
}

@Entity()
export class SecureParent {
  @Field(f.number().id())
  id?: number;
  @Field(f.references(() => SecureRelated).nullable())
  relatedId?: number | null;
  @ManyToOne({ entity: () => SecureRelated, references: (secureParent) => secureParent.relatedId })
  related?: SecureRelated;
}

/** The relation-subquery target: a `security: true` filter and a soft-delete field must both scope it. */
@Entity({
  filters: {
    tenant: {
      where: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
      security: true,
    },
  },
})
export class SecureChild {
  @Field(f.number().id())
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
  @ManyToOne({ entity: () => SecureCollection, references: (secureChild) => secureChild.collectionId })
  collection?: SecureCollection;
}

/** No filters of its own, so a count over the junction to it stays junction-only. */
@Entity()
export class PlainChild {
  @Field(f.number().id())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  collectionId?: number | null;
  @ManyToOne({ entity: () => SecureCollection, references: (plainChild) => plainChild.collectionId })
  collection?: SecureCollection;
}

/** A many-to-many's junction: each side joins by the one column referencing it. */
@Entity()
class SecureCollectionChild {
  @Field(f.number().id())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  secureCollectionId?: number | null;
  @Field(f.references(() => SecureChild).nullable())
  secureChildId?: number | null;
}

@Entity()
class SecureCollectionPlain {
  @Field(f.number().id())
  id?: number;
  @Field(f.references(() => SecureCollection).nullable())
  secureCollectionId?: number | null;
  @Field(f.references(() => PlainChild).nullable())
  plainChildId?: number | null;
}

/** Junction whose FK columns are renamed, so the mm form has to resolve them too. */
@Entity()
class SecureCollectionRenamed {
  @Field(f.number().id())
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
  @Field(f.number().id())
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
  @Field(f.number().id())
  id?: number;
  @OneToMany({ entity: () => SecureChild, mappedBy: (secureChild) => secureChild.collectionId })
  children?: SecureChild[];
  @ManyToMany({ entity: () => SecureChild, through: () => SecureCollectionChild })
  taggedChildren?: SecureChild[];
  @ManyToMany({ entity: () => PlainChild, through: () => SecureCollectionPlain })
  plainChildren?: PlainChild[];
  @ManyToMany({ entity: () => PlainChild, through: () => SecureCollectionLink })
  linkedChildren?: PlainChild[];
  @ManyToMany({ entity: () => SecureChild, through: () => SecureCollectionRenamed })
  renamedChildren?: SecureChild[];
}
