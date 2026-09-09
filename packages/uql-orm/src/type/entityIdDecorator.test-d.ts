/**
 * Type-level regression tests for what `@Id` refuses: a key the type level cannot name. Where no
 * conventional name and no `idKey` brand applies, `IdKey` falls back to every field, and `IdValue`,
 * `EntityId` and every by-id method are then typed against a column that is not the key - silently,
 * until this check. The precedence itself is pinned in `entityId.test-d.ts`.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, left out of the build.
 */
import { Field, Id, idKey } from '../index.js';

// A conventional name is enough: `id`, `_id` and `uuid` are the names `IdKey` reads without help.
class WithId {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

class WithMongoId {
  @Id({ type: String }) _id?: string;
  @Field({ type: String }) name?: string;
}

class WithUuid {
  @Id({ type: String }) uuid?: string;
  @Field({ type: String }) name?: string;
}

// Any other name is named by the brand.
class Branded {
  [idKey]?: 'pk';
  @Id({ type: Number }) pk?: number;
  @Field({ type: String }) name?: string;
}

class Unbranded {
  // @ts-expect-error `pk` is not a name `IdKey` reads, so the key needs the `idKey` brand
  @Id({ type: Number }) pk?: number;
  @Field({ type: String }) name?: string;
}

// A composite is never conventional: two keys can only be named by the brand.
class CompositeBranded {
  [idKey]?: 'studentId' | 'courseId';
  @Id({ type: Number }) studentId?: number;
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string;
}

class CompositeUnbranded {
  // @ts-expect-error the brand has to name both keys
  @Id({ type: Number }) studentId?: number;
  // @ts-expect-error the brand has to name both keys
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string;
}

// An inherited conventional key outranks the fallback, so a subclass that replaces it says so.
class Base {
  @Id({ type: String }) id?: string;
}

class Replaced extends Base {
  [idKey]?: 'pk';
  @Id({ type: String }) pk?: string;
}
