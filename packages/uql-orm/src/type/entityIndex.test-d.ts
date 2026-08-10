/**
 * Type-level regression tests for `@Index` options.
 *
 * Vector index types must declare their `distance`: omitting it silently changes the generated DDL
 * (MariaDB's `DISTANCE=` defaults to euclidean, so a cosine query full-scans; pgvector has no
 * default operator class). MongoDB's `vectorSearch` is exempt - its generator emits no metric.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import { Entity, Field, Id, Index, ManyToOne } from '../index.js';
import { raw } from '../util/index.js';

@Index(['embedding'], { type: 'hnsw', distance: 'cosine', m: 16 })
@Index(['embedding'], { type: 'ivfflat', distance: 'l2', lists: 100 })
@Index(['embedding'], { type: 'vector', distance: 'cosine', name: 'crdb_native' })
@Index(['title'], { unique: true })
@Index(['title'], { type: 'gin' })
@Index(['title'], { where: "title <> ''" })
// Column entry sugar: a raw expression, and the object form's length/order/nulls/opsClass modifiers.
@Index([raw('lower(title)')], { unique: true })
@Index([{ column: 'title', length: 64, order: 'desc', nulls: 'last', opsClass: 'text_ops' }])
@Entity()
export class Article {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[];
}

/**
 * `IndexTypeOptions` pairs a vector index `type` with a mandatory `distance` and forbids `distance`
 * everywhere else (see its doc comment) - without that explicit `never`, `VectorIndexOptions`'
 * optional `distance` would survive the intersection and silently typecheck this.
 */
// @ts-expect-error a non-vector index type cannot declare a distance metric
@Index(['title'], { type: 'gin', distance: 'cosine' })
@Entity()
export class NonVectorIndexWithDistance {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
}

// @ts-expect-error hnsw needs a distance metric
@Index(['embedding'], { type: 'hnsw' })
// @ts-expect-error ivfflat needs a distance metric
@Index(['embedding'], { type: 'ivfflat', lists: 10 })
// @ts-expect-error CockroachDB's native vector index needs a distance metric
@Index(['embedding'], { type: 'vector' })
@Entity()
export class MissingMetric {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[];
}

/**
 * Column names are checked against the decorated class, which a legacy property decorator could not do:
 * the entity type is inferred from where the returned decorator lands.
 */
@Index([{ column: 'title', order: 'desc' }, 'id'])
// @ts-expect-error no such column
@Index(['titel'])
// @ts-expect-error no such column in the object form either
@Index([{ column: 'titel' }])
// @ts-expect-error a relation is not a column; index its foreign key instead
@Index(['author'])
@Entity()
export class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ references: () => Article }) articleId?: number;
  @ManyToOne({ entity: () => Article }) author?: Article;
}
