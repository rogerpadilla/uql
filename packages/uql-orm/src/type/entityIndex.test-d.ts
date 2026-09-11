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
import { Entity, Field, Id, Index, type Json, ManyToOne } from '../index.js';
import { raw } from '../util/index.js';

@Index((article) => [article.embedding], { type: 'hnsw', distance: 'cosine', m: 16 })
@Index((article) => [article.embedding], { type: 'ivfflat', distance: 'l2', lists: 100 })
@Index((article) => [article.embedding], { type: 'vector', distance: 'cosine', name: 'crdb_native' })
@Index((article) => [article.title], { unique: true })
@Index((article) => [article.title], { type: 'gin' })
@Index((article) => [article.title], { where: "title <> ''" })
// Column entry sugar: a raw expression, and the object form's length/order/nulls/opsClass modifiers.
@Index((article) => [raw`lower(title)`], { unique: true })
@Index((article) => [{ column: article.title, length: 64, order: 'desc', nulls: 'last', opsClass: 'text_ops' }])
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
@Index((nonVectorIndexWithDistance) => [nonVectorIndexWithDistance.title], { type: 'gin', distance: 'cosine' })
@Entity()
export class NonVectorIndexWithDistance {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
}

// @ts-expect-error hnsw needs a distance metric
@Index((missingMetric) => [missingMetric.embedding], { type: 'hnsw' })
// @ts-expect-error ivfflat needs a distance metric
@Index((missingMetric) => [missingMetric.embedding], { type: 'ivfflat', lists: 10 })
// @ts-expect-error CockroachDB's native vector index needs a distance metric
@Index((missingMetric) => [missingMetric.embedding], { type: 'vector' })
@Entity()
export class MissingMetric {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[];
}

/**
 * Column names are checked against the decorated class, which a legacy property decorator could not do:
 * the entity type is inferred from where the returned decorator lands.
 */
@Index((post) => [{ column: post.title, order: 'desc' }, post.id])
// @ts-expect-error no such column
@Index((post) => [post.titel])
// @ts-expect-error no such column in the object form either
@Index((post) => [{ column: post.titel }])
// @ts-expect-error a relation is not a column; index its foreign key instead
@Index((post) => [post.author])
@Entity()
export class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ references: () => Article }) articleId?: number;
  @ManyToOne({ entity: () => Article }) author?: Article;
}

/** `include`'s columns are the entity's too: a typo there builds nothing, the server refusing it. */
@Index((covering) => [covering.title], { include: (covering) => [covering.id] })
// @ts-expect-error no such column to include
@Index((covering) => [covering.title], { include: (covering) => [covering.idd] })
@Entity()
export class Covering {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
}

/**
 * A JSON entry's path is checked against the payload of the column the same entry names. It matters
 * more here than anywhere else in the index API: a misspelled path still builds a perfectly valid
 * index, one no query will ever match, and nothing at runtime can tell that from the index meant.
 */
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { path: 'theme.color', type: String } }])
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { path: 'theme', type: String } }])
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { path: 'rating', type: Number } }])
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonArray: { path: 'ids', type: Number } }])
// the column is the array itself, so there is no path to name
@Index((jsonIndexed) => [{ column: jsonIndexed.tags, jsonArray: { type: String, length: 64 } }])
// an untyped payload accepts any path, since there is nothing to check it against
@Index((jsonIndexed) => [{ column: jsonIndexed.loose, jsonPath: { path: 'anything.at.all', type: String } }])
// @ts-expect-error typo in the leaf segment
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { path: 'theme.colour', type: String } }])
// @ts-expect-error typo in the root segment
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { path: 'thema.color', type: String } }])
// @ts-expect-error the path belongs to another column
@Index((jsonIndexed) => [{ column: jsonIndexed.tags, jsonPath: { path: 'theme.color', type: String } }])
// @ts-expect-error `tags` is the array, so `jsonArray` there takes no path
@Index((jsonIndexed) => [{ column: jsonIndexed.tags, jsonArray: { path: 'ids', type: String, length: 8 } }])
// @ts-expect-error not a JSON column at all
@Index((jsonIndexed) => [{ column: jsonIndexed.title, jsonPath: { path: 'x', type: String } }])
// @ts-expect-error a JSON path entry needs the path it indexes
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { type: String } }])
// @ts-expect-error a JSON path entry needs the type its path is read as
@Index((jsonIndexed) => [{ column: jsonIndexed.kind, jsonPath: { path: 'rating' } }])
@Index((jsonIndexed) => [
  // @ts-expect-error an entry reads one thing: never both forms at once
  { column: jsonIndexed.kind, jsonPath: { path: 'rating', type: Number }, jsonArray: { type: Number } },
])
// @ts-expect-error no such column
@Index((jsonIndexed) => [{ column: jsonIndexed.knid, jsonPath: { path: 'rating', type: Number } }])
@Entity()
export class JsonIndexed {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ type: 'json' }) kind?: Json<{ theme: { color: string }; rating: number; ids: number[] }>;
  @Field({ type: 'json' }) tags?: Json<string[]>;
  @Field({ type: 'json' }) loose?: Json<unknown>;
}
