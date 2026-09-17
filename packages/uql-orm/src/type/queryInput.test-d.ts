/**
 * Find-query input: a typo'd key fails in every clause, natively where typed against `Query<E>` and by
 * its own key constraint where the result captures it. A vector distance projection is annotated with
 * `WithDistance`. Type-checked by `bun run ts` only.
 */
import type { Querier, WithDistance } from '../index.js';

class Author {
  id!: number;
  name!: string;
}

class Article {
  id!: number;
  title!: string;
  embedding!: number[];
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

  // Vector-search results are plain entities; annotate with WithDistance to type the projected score.
  const scored = (await querier.findMany(Article, {
    $sort: { embedding: { $vector: [1], $project: 'similarity' } },
  })) as WithDistance<Article, 'similarity'>[];
  const similarity: number = scored[0].similarity;
  void similarity;
}
