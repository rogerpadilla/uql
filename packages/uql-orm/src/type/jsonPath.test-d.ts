/**
 * Type-level regression tests for typed JSON dot-paths in `$where` and `$sort`.
 *
 * Dotted keys are restricted to real JSON fields: a typed `Json<T>` payload produces one typed
 * path per (nested) key, and each path's value resolves via `JsonFieldPathValue` so operators and
 * values are checked against the path's own type. Untyped `Json<unknown>` payloads accept any
 * `field.suffix` path with fully permissive values. Relations are filtered via nested objects,
 * never dotted keys (matching the runtime, which throws for non-JSON dotted keys).
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Json, Querier } from '../index.js';

class Writer {
  id!: number;
  name!: string;
}

class Post {
  id!: number;
  title!: string;
  kind?: Json<{ public?: 0 | 1; theme?: { color?: string }; labels?: string[] }>;
  data?: Json<unknown>;
  attachments?: Json<unknown[]>;
  items?: Json<{ id: string; count: number; tags: string[] }>[];
  writer?: Writer;
}

declare const querier: Querier;

export async function jsonDotPathSafety() {
  // Typed paths resolve their value type: string paths get string operators, numeric paths
  // numeric operators, array paths array operators.
  await querier.findMany(Post, {
    $where: {
      'kind.public': { $gt: 0 },
      'kind.theme.color': { $startsWith: 'da' },
      'kind.labels': { $size: 2 },
    },
    $sort: { 'kind.public': 1 },
  });

  // Untyped Json payloads keep dot-path ergonomics: any suffix, and the FULL operator set stays
  // available - including the array operators, whose values are permissive on untyped paths.
  await querier.findMany(Post, { $where: { 'data.anything.deep': { $like: '%x%' } } });
  await querier.findMany(Post, { $where: { 'data.list': { $all: [1, 'x'] } } });
  await querier.findMany(Post, { $where: { 'data.list': { $elemMatch: { anyKey: { $gt: 1 } } } } });

  // A column holding a list of documents paths through its element type, each path typed by the
  // element's own key.
  await querier.findMany(Post, {
    $where: {
      'items.id': { $startsWith: 'a' },
      'items.count': { $gte: 2 },
      'items.tags': { $size: 3 },
    },
    $sort: { 'items.count': 1 },
  });
  // @ts-expect-error 'items.id' holds a string, not a number
  await querier.findMany(Post, { $where: { 'items.id': 7 } });
  // @ts-expect-error $startsWith (string-only) is not applicable to a number-typed path
  await querier.findMany(Post, { $where: { 'items.count': { $startsWith: 'a' } } });
  // @ts-expect-error 'nope' is not a key of Post.items' element
  await querier.findMany(Post, { $where: { 'items.nope': 1 } });

  // @ts-expect-error an array of Json takes no JSON update operators; replace the whole value
  await querier.updateOneById(Post, 1, { items: { $set: { id: 'a' } } });

  // Untyped array elements accept any keys, but $elemMatch still requires an object of conditions.
  await querier.findMany(Post, { $where: { attachments: { $elemMatch: { anyKey: 'x' } } } });
  // @ts-expect-error $elemMatch takes an object of conditions, not a bare scalar
  await querier.findMany(Post, { $where: { attachments: { $elemMatch: 5 } } });

  // JSON update operators are exclusive to Json fields.
  await querier.updateOneById(Post, 1, { kind: { $set: { public: 1 } } });
  // @ts-expect-error a plain string field does not accept JSON update operators
  await querier.updateOneById(Post, 1, { title: {} });

  // `$push`/`$pull` target array keys only, with the value typed as the element.
  await querier.updateOneById(Post, 1, { kind: { $push: { labels: 'new' }, $pull: { labels: 'stale' } } });
  await querier.updateOneById(Post, 1, {
    kind: { $pull: { labels: 'a' }, $push: { labels: 'b' }, $unset: ['public'] },
  });
  // @ts-expect-error 'public' is not an array key, so it is not a $pull target
  await querier.updateOneById(Post, 1, { kind: { $pull: { public: 1 } } });
  // @ts-expect-error labels holds strings, not numbers
  await querier.updateOneById(Post, 1, { kind: { $pull: { labels: 7 } } });
  // @ts-expect-error $pull takes one element value per key, not an array of them
  await querier.updateOneById(Post, 1, { kind: { $pull: { labels: ['a', 'b'] } } });

  // A payload that is itself an array takes no operators - they all address object keys, and no
  // dialect gives them a meaningful result on such a column. Replace the whole value instead.
  await querier.updateOneById(Post, 1, { attachments: ['a', 'b'] });
  // @ts-expect-error $set on an array payload would concatenate on PostgreSQL and no-op elsewhere
  await querier.updateOneById(Post, 1, { attachments: { $set: { 0: 'x' } } });
  // @ts-expect-error $unset on an array payload would target array method names
  await querier.updateOneById(Post, 1, { attachments: { $unset: ['length'] } });

  // An untyped payload is not an array, so it keeps the full operator set.
  await querier.updateOneById(Post, 1, { data: { $set: { anything: 1 }, $unset: ['other'] } });

  // Unknown path on a typed JSON payload is a compile error.
  // @ts-expect-error 'nope' is not a key of Post.kind
  await querier.findMany(Post, { $where: { 'kind.nope': 1 } });

  // The `Json` brand is not a path: `Json<P>`'s payload infers as `P` alone, so the marker key
  // never reaches the key derivation in the first place.
  // @ts-expect-error '__json' is a brand, not a key of the payload
  await querier.findMany(Post, { $where: { 'kind.__json': 1 } });
  // @ts-expect-error and it is not a key of an array payload's element either
  await querier.findMany(Post, { $where: { 'items.__json': 1 } });

  // Dot-paths on non-JSON scalar fields are compile errors.
  // @ts-expect-error 'title' is not a JSON field
  await querier.findMany(Post, { $where: { 'title.foo': 1 } });

  // Relations are filtered via nested objects, not dotted keys.
  await querier.findMany(Post, { $where: { writer: { name: 'x' } } });
  // @ts-expect-error relation dot-paths are not supported
  await querier.findMany(Post, { $where: { 'writer.name': 'x' } });

  // Typed path values reject mismatched operators and values.
  // @ts-expect-error $size (array-only) is not applicable to a string-typed path
  await querier.findMany(Post, { $where: { 'kind.theme.color': { $size: 5 } } });
  // @ts-expect-error $gt value must match the path's type (string), not a number
  await querier.findMany(Post, { $where: { 'kind.theme.color': { $gt: 5 } } });
  // @ts-expect-error value must match the path's type
  await querier.findMany(Post, { $where: { 'kind.public': 'nope' } });

  // $sort dot-paths are restricted to JSON fields too.
  // @ts-expect-error 'title' is not a JSON field
  await querier.findMany(Post, { $sort: { 'title.foo': 1 } });
}
