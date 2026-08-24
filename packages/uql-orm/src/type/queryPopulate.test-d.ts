/**
 * Type-level regression tests for `$populate`: a to-one relation is restricted to `QueryUnique`
 * (`$select`/`$exclude`/`$populate`/`$where` - it resolves to at most one row already, so pagination
 * and sorting make no sense on it), while a to-many relation gets the full `Query<E>` shape. `$required`
 * is available on either cardinality.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Querier } from '../index.js';

class Writer {
  id!: number;
  name!: string;
}

class Comment {
  id!: number;
  body!: string;
  storyId!: number;
}

class Story {
  id!: number;
  title!: string;
  writer?: Writer;
  comments?: Comment[];
  drafts?: readonly Comment[];
}

declare const querier: Querier;

export async function populateCardinalityShapes() {
  // A to-one relation accepts $select/$exclude/$populate/$where and $required.
  await querier.findMany(Story, {
    $populate: { writer: { $select: { name: true }, $where: { id: 1 }, $required: true } },
  });
  await querier.findMany(Story, { $populate: { writer: true } });

  // A to-many relation accepts the full Query shape - pagination and sorting included, `readonly` or not.
  await querier.findMany(Story, {
    $populate: { comments: { $select: { body: true }, $sort: { id: -1 }, $limit: 5, $required: true } },
  });
  await querier.findMany(Story, { $populate: { drafts: { $sort: { id: -1 }, $limit: 5 } } });

  // @ts-expect-error a to-one relation resolves to one row already; $sort does not apply
  await querier.findMany(Story, { $populate: { writer: { $sort: { name: 1 } } } });
  // @ts-expect-error a to-one relation resolves to one row already; $limit does not apply
  await querier.findMany(Story, { $populate: { writer: { $limit: 1 } } });
  // @ts-expect-error a to-one relation resolves to one row already; $skip does not apply
  await querier.findMany(Story, { $populate: { writer: { $skip: 1 } } });
  // @ts-expect-error a to-one relation resolves to one row already; $distinct does not apply
  await querier.findMany(Story, { $populate: { writer: { $distinct: true } } });

  // Nested $populate on a populated relation is still typed against its own entity.
  await querier.findMany(Story, { $populate: { comments: { $where: { body: 'x' } } } });
  // @ts-expect-error 'bdoy' is not a field of Comment
  await querier.findMany(Story, { $populate: { comments: { $where: { bdoy: 'x' } } } });
}

/**
 * Every clause of a populated relation, checked against the relation's own fields. The populate value
 * used to distribute over the `undefined` an optional relation carries, into an arm that accepted any
 * key at all - so `$select` with a misspelling in it compiled clean.
 */
export async function populatedRelationFieldsAreChecked() {
  await querier.findMany(Story, { $populate: { comments: { $select: { body: true } } } });
  // @ts-expect-error 'bdoy' is not a field of Comment
  await querier.findMany(Story, { $populate: { comments: { $select: { bdoy: true } } } });
  // @ts-expect-error 'bdoy' is not a field of Comment
  await querier.findMany(Story, { $populate: { comments: { $exclude: { bdoy: true } } } });
  // @ts-expect-error 'bdoy' is not a field of Comment
  await querier.findMany(Story, { $populate: { comments: { $sort: { bdoy: 1 } } } });

  // The same for a to-one relation, whose value took the other arm of that union.
  await querier.findMany(Story, { $populate: { writer: { $select: { name: true } } } });
  // @ts-expect-error 'nmae' is not a field of Writer
  await querier.findMany(Story, { $populate: { writer: { $select: { nmae: true } } } });
  // @ts-expect-error 'nmae' is not a field of Writer
  await querier.findMany(Story, { $populate: { writer: { $exclude: { nmae: true } } } });
  // @ts-expect-error 'bdoy' is not a field of Comment
  await querier.findMany(Story, { $populate: { drafts: { $select: { bdoy: true } } } });
}
