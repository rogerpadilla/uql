/**
 * `$populate`: a to-one takes `QueryUnique`, being one row already, and a to-many the full `Query<E>`;
 * `$required` goes on either. Type-checked by `bun run ts` only.
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
 * Every clause of a populated relation is checked against the relation's own fields, an optional
 * relation's included.
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
