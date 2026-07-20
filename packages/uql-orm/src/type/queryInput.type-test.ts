/**
 * Type-level regression tests for find-query input safety.
 *
 * Find methods take a concrete `Query<E>` parameter, so TypeScript's native excess-property
 * checking rejects a typo'd key in any clause. Vector-search distance projection is not auto-typed;
 * annotate the result with `WithDistance` when a `$sort` `$project` is used.
 *
 * Not a runtime test: it has no assertions to execute. It is type-checked by `bun run ts`
 * (tsc over the whole tree), skipped by vitest (which collects only `.test.ts` / `.spec.ts`),
 * and left out of the build (excluded by the `-test.ts` suffix). Each `@ts-expect-error` fails
 * the type-check if the error it guards ever stops happening, keeping the negatives locked in.
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

  // Excess/typo keys are rejected natively, even next to a valid key.
  // @ts-expect-error 'titel' is not a field of Article
  await querier.findMany(Article, { $select: { title: true, titel: true } });
  // @ts-expect-error 'titel' is not a field of Article
  await querier.findOne(Article, { $where: { title: 'x', titel: 'y' } });
  // @ts-expect-error 'bad' is not a relation of Article
  await querier.findMany(Article, { $populate: { author: true, bad: true } });
  // @ts-expect-error 'titel' is not a sortable key of Article
  await querier.findMany(Article, { $sort: { titel: 1 } });

  // Vector-search results are plain entities; annotate with WithDistance to type the projected score.
  const scored = (await querier.findMany(Article, {
    $sort: { embedding: { $vector: [1], $project: 'similarity' } },
  })) as WithDistance<Article, 'similarity'>[];
  const similarity: number = scored[0].similarity;
  void similarity;
}
