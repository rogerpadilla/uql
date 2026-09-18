/**
 * What `@Id` refuses: a key the type level cannot name, since `IdKey` would fall back to every field and
 * type every by-id method against the wrong column. The precedence is in `entityId.test-d.ts`.
 */
import { Field, Id, idKey } from '../index.js';

// A conventional name is enough: `id`, `_id` and `uuid` are the names `IdKey` reads without help.
export class WithId {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
}

export class WithMongoId {
  @Id({ type: String }) _id?: string;
  @Field({ type: String }) name?: string | null;
}

export class WithUuid {
  @Id({ type: String }) uuid?: string;
  @Field({ type: String }) name?: string | null;
}

// Any other name is named by the brand.
export class Branded {
  [idKey]?: 'pk';
  @Id({ type: Number }) pk?: number;
  @Field({ type: String }) name?: string | null;
}

export class Unbranded {
  // @ts-expect-error `pk` is not a name `IdKey` reads, so the key needs the `idKey` brand
  @Id({ type: Number }) pk?: number;
  @Field({ type: String }) name?: string | null;
}

// A composite is never conventional: two keys can only be named by the brand.
export class CompositeBranded {
  [idKey]?: 'studentId' | 'courseId';
  @Id({ type: Number }) studentId?: number;
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string | null;
}

export class CompositeUnbranded {
  // @ts-expect-error the brand has to name both keys
  @Id({ type: Number }) studentId?: number;
  // @ts-expect-error the brand has to name both keys
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string | null;
}

// An inherited conventional key outranks the fallback, so a subclass that replaces it says so.
class Base {
  @Id({ type: String }) id?: string;
}

export class Replaced extends Base {
  [idKey]?: 'pk';
  @Id({ type: String }) pk?: string;
}
