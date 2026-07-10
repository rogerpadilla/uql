/**
 * Type-level regression tests for `$project` distance inference on find methods.
 *
 * Not a runtime test: it has no assertions to execute. It is type-checked by `bun run ts`
 * (tsc over the whole tree), skipped by vitest (which collects only `.test.ts` / `.spec.ts`),
 * and left out of the build (excluded by the `-test.ts` suffix). Each `@ts-expect-error` fails
 * the type-check if the error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Querier, QuerierPool, WithDistance } from '../index.js';

class Article {
  id!: number;
  title!: string;
  embedding!: number[];
}

declare const querier: Querier;
declare const pool: QuerierPool;

export async function projectionInference() {
  // Positive: a projected distance is present on the result and typed `number`, no cast.
  const projected = await querier.findMany(Article, {
    $sort: { embedding: { $vector: [1], $project: 'similarity' } },
  });
  const similarity: number = projected[0].similarity;
  void similarity;

  // Negative: a plain query carries no projected field.
  const plain = await querier.findMany(Article, { $where: { title: 'x' } });
  // @ts-expect-error 'similarity' is not on a non-projecting result
  void plain[0].similarity;

  // Negative: only the key you projected exists, not some other name.
  // @ts-expect-error only 'similarity' was projected
  void projected[0].distance;

  // Negative: a vector sort without `$project` adds nothing (mirrors the runtime).
  const unprojected = await querier.findMany(Article, {
    $sort: { embedding: { $vector: [1] } },
  });
  // @ts-expect-error no `$project`, so no extra field
  void unprojected[0].similarity;

  // RPC `{ $entity }` form infers the projection too.
  const rpc = await querier.findMany({
    $entity: Article,
    $sort: { embedding: { $vector: [1], $project: 'score' } },
  });
  const score: number = rpc[0].score;
  void score;

  // The other read methods carry it as well.
  const one = await querier.findOne(Article, {
    $sort: { embedding: { $vector: [1], $project: 'dist' } },
  });
  const oneDist: number | undefined = one?.dist;
  void oneDist;

  const [counted] = await querier.findManyAndCount(Article, {
    $sort: { embedding: { $vector: [1], $project: 'dist' } },
  });
  const countedDist: number = counted[0].dist;
  void countedDist;

  for await (const row of querier.findManyStream(Article, {
    $sort: { embedding: { $vector: [1], $project: 'dist' } },
  })) {
    const streamedDist: number = row.dist;
    void streamedDist;
  }

  // The pool exposes the same inference.
  const poolProjected = await pool.findMany(Article, {
    $sort: { embedding: { $vector: [1], $project: 'similarity' } },
  });
  const poolSimilarity: number = poolProjected[0].similarity;
  void poolSimilarity;

  // Backward compatible: the inferred result still satisfies the exported `WithDistance` helper.
  const legacy: WithDistance<Article, 'similarity'>[] = projected;
  void legacy;
}
