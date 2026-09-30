/**
 * `findManyPage`: the page narrows its rows as `findMany` does, sizes itself by a `$limit` it cannot go
 * without, and takes no `$skip`. Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import type { CursorPage, Querier } from '../index.js';

class Post {
  id!: number;
  title!: string;
}

export async function pageNarrowsItsRows(querier: Querier) {
  const page = await querier.findManyPage(Post, { $select: { title: true }, $sort: { id: 1 }, $limit: 10 });
  expectTypeOf(page).toEqualTypeOf<CursorPage<Pick<Post, 'title'>>>();

  const next = await querier.findManyPage({ $entity: Post, $sort: { id: 1 }, $limit: 10, $after: page.endCursor });
  expectTypeOf(next.items).toEqualTypeOf<Post[]>();
}

export async function pageTakesASizeAndNoOffset(querier: Querier) {
  // @ts-expect-error a page names how many rows it holds
  await querier.findManyPage(Post, { $sort: { id: 1 } });
  // @ts-expect-error an offset reintroduces the drift a cursor removes
  await querier.findManyPage(Post, { $sort: { id: 1 }, $limit: 10, $skip: 10 });
  // @ts-expect-error a cursor is the text a page handed out
  await querier.findManyPage(Post, { $sort: { id: 1 }, $limit: 10, $after: 1 });
}
