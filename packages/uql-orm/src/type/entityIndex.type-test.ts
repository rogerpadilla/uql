/**
 * Type-level regression tests for `@Index` options.
 *
 * Vector index types must declare their `distance`: omitting it silently changes the generated DDL
 * (MariaDB's `DISTANCE=` defaults to euclidean, so a cosine query full-scans; pgvector has no
 * default operator class). MongoDB's `vectorSearch` is exempt - its generator emits no metric.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `-test.ts` suffix). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import { Entity, Field, Id, Index } from '../index.js';

@Index(['embedding'], { type: 'hnsw', distance: 'cosine', m: 16 })
@Index(['embedding'], { type: 'ivfflat', distance: 'l2', lists: 100 })
@Index(['embedding'], { type: 'vector', distance: 'cosine', name: 'crdb_native' })
@Index(['title'], { unique: true })
@Index(['title'], { type: 'gin' })
@Index(['title'], { where: "title <> ''" })
@Entity()
export class Article {
  @Id() id?: number;
  @Field() title?: string;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[];
}

// @ts-expect-error hnsw needs a distance metric
@Index(['embedding'], { type: 'hnsw' })
// @ts-expect-error ivfflat needs a distance metric
@Index(['embedding'], { type: 'ivfflat', lists: 10 })
// @ts-expect-error CockroachDB's native vector index needs a distance metric
@Index(['embedding'], { type: 'vector' })
@Entity()
export class MissingMetric {
  @Id() id?: number;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[];
}
