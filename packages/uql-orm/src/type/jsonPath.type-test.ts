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
 * build (excluded by the `-test.ts` suffix). Each `@ts-expect-error` fails the type-check if the
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

  // Untyped array elements accept any keys, but $elemMatch still requires an object of conditions.
  await querier.findMany(Post, { $where: { attachments: { $elemMatch: { anyKey: 'x' } } } });
  // @ts-expect-error $elemMatch takes an object of conditions, not a bare scalar
  await querier.findMany(Post, { $where: { attachments: { $elemMatch: 5 } } });

  // JSON update operators are exclusive to Json fields.
  await querier.updateOneById(Post, 1, { kind: { $merge: { public: 1 } } });
  // @ts-expect-error a plain string field does not accept JSON update operators
  await querier.updateOneById(Post, 1, { title: {} });

  // Unknown path on a typed JSON payload is a compile error.
  // @ts-expect-error 'nope' is not a key of Post.kind
  await querier.findMany(Post, { $where: { 'kind.nope': 1 } });

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
