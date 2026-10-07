import { Entity, Field, Filter, Id, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';

declare module '../type/index.js' {
  interface UqlContext {
    secureTenantId?: number;
  }
}

/** The joined (m1) side of a `security: true` filter, which a JOIN or a populate applies as a read does. */
@Filter('tenant', {
  where: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
  security: true,
})
@Entity()
export class SecureRelated {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number | null;
  @Field({ type: String })
  name?: string | null;
}

@Entity()
export class SecureParent {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureRelated })
  relatedId?: number | null;
  @ManyToOne({ entity: () => SecureRelated, references: (secureParent) => secureParent.relatedId })
  related?: SecureRelated;
}

/** The relation-subquery target: a `security: true` filter and a soft-delete field must both scope it. */
@Filter('tenant', {
  where: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
  security: true,
})
@Entity()
export class SecureChild {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number | null;
  @Field({ references: () => SecureCollection })
  collectionId?: number | null;
  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number | null;
  @ManyToOne({ entity: () => SecureCollection, references: (secureChild) => secureChild.collectionId })
  collection?: SecureCollection;
}

/** No filters of its own, so a count over the junction to it stays junction-only. */
@Entity()
export class PlainChild {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  collectionId?: number | null;
  @ManyToOne({ entity: () => SecureCollection, references: (plainChild) => plainChild.collectionId })
  collection?: SecureCollection;
}

/** A many-to-many's junction: each side joins by the one column referencing it. */
@Entity()
class SecureCollectionChild {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  secureCollectionId?: number | null;
  @Field({ references: () => SecureChild })
  secureChildId?: number | null;
}

@Entity()
class SecureCollectionPlain {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  secureCollectionId?: number | null;
  @Field({ references: () => PlainChild })
  plainChildId?: number | null;
}

/** Junction whose FK columns are renamed, so the mm form has to resolve them too. */
@Entity()
class SecureCollectionRenamed {
  @Id({ type: Number })
  id?: number;
  @Field({ name: 'renamed_collection', references: () => SecureCollection })
  secureCollectionId?: number | null;
  @Field({ name: 'renamed_child', references: () => SecureChild })
  secureChildId?: number | null;
}

/** A soft-deletable junction: an unlinked row must not count as a link. */
@Entity()
class SecureCollectionLink {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  secureCollectionId?: number | null;
  @Field({ references: () => PlainChild })
  plainChildId?: number | null;
  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number | null;
}

@Entity()
export class SecureCollection {
  @Id({ type: Number })
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
