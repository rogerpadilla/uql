/**
 * What `@Id` refuses: a key the type level cannot name, since `IdKey` would fall back to every field and
 * type every by-id method against the wrong column. The precedence is in `entityId.test-d.ts`.
 */
import { f, Field, idKey } from '../index.js';

// A conventional name is enough: `id`, `_id` and `uuid` are the names `IdKey` reads without help.
export class WithId {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
}

export class WithMongoId {
  @Field(f.string().id()) _id?: string;
  @Field(f.string().nullable()) name?: string | null;
}

export class WithUuid {
  @Field(f.string().id()) uuid?: string;
  @Field(f.string().nullable()) name?: string | null;
}

// Any other name is named by the brand.
export class Branded {
  [idKey]?: 'pk';
  @Field(f.number().id()) pk?: number;
  @Field(f.string().nullable()) name?: string | null;
}

export class Unbranded {
  // @ts-expect-error `pk` is not a name `IdKey` reads, so the key needs the `idKey` brand
  @Field(f.number().id()) pk?: number;
  @Field(f.string().nullable()) name?: string | null;
}

// A composite is never conventional: two keys can only be named by the brand.
export class CompositeBranded {
  [idKey]?: 'studentId' | 'courseId';
  @Field(f.number().id()) studentId?: number;
  @Field(f.string().id()) courseId?: string;
  @Field(f.string().nullable()) grade?: string | null;
}

export class CompositeUnbranded {
  // @ts-expect-error the brand has to name both keys
  @Field(f.number().id()) studentId?: number;
  // @ts-expect-error the brand has to name both keys
  @Field(f.string().id()) courseId?: string;
  @Field(f.string().nullable()) grade?: string | null;
}

// An inherited conventional key outranks the fallback, so a subclass that replaces it says so.
class Base {
  @Field(f.string().id()) id?: string;
}

export class Replaced extends Base {
  [idKey]?: 'pk';
  @Field(f.string().id()) pk?: string;
}
