/**
 * Find-query input: a typo'd key fails in every clause, natively where typed against `Query<E>` and by
 * its own key constraint where the result captures it. Type-checked by `bun run ts` only.
 */
import type { Querier } from '../index.js';

class Author {
  id!: number;
  name!: string;
}

class Article {
  id!: number;
  title!: string;
  author?: Author;
}

declare const querier: Querier;

export async function findInputSafety() {
  // Valid queries compile.
  await querier.findMany(Article, { $select: { id: true, title: true }, $where: { title: 'x' }, $limit: 5 });

  // Excess/typo keys are rejected even next to a valid key.
  // @ts-expect-error 'titel' is not a field of Article
  await querier.findMany(Article, { $select: { title: true, titel: true } });
  // @ts-expect-error 'titel' is not a field of Article
  await querier.findOne(Article, { $where: { title: 'x', titel: 'y' } });
  // @ts-expect-error 'bad' is not a relation of Article
  await querier.findMany(Article, { $populate: { author: true, bad: true } });
  // @ts-expect-error 'titel' is not a sortable key of Article
  await querier.findMany(Article, { $sort: { titel: 1 } });
  // @ts-expect-error '$selct' is not a query clause
  await querier.findMany(Article, { $select: { id: true }, $selct: { title: true } });
}
