/**
 * Index options: a vector index declares its `distance`, since the engines default it differently
 * (MariaDB to euclidean, pgvector to none); MongoDB's `vectorSearch` emits no metric and is exempt.
 * Type-checked by `bun run ts` only.
 */
import { Entity, f, Field, type IndexSection, type Json, ManyToOne } from '../index.js';
import { sql } from '../util/index.js';

/** One index, checked on its own: inside one `@Entity` call, an error in one entry hides another's. */
declare function indexOf<E>(indexes: IndexSection<E>): void;

@Entity({
  indexes: (article, index) => [
    // A fulltext column's weight is a number on every engine, never a Postgres label.
    index([{ column: article.title, weight: 2 }], { type: 'fulltext' }),
    // Column entry sugar: an expression, and the object form's prefixLength/order/nulls/opsClass modifiers.
    index([{ column: article.title, prefixLength: 64, order: 'desc', nulls: 'last', opsClass: 'text_ops' }]),
    index([sql`lower(${article.title})`], { unique: true }),
    index([article.title], { where: { title: { $ne: '' } } }),
    index([article.title], { type: 'gin' }),
    index([article.title], { unique: true }),
    index([article.embedding], { type: 'vector', distance: 'cosine', name: 'crdb_native' }),
    index([article.embedding], { type: 'ivfflat', distance: 'l2', lists: 100 }),
    index([article.embedding], { type: 'hnsw', distance: 'cosine', m: 16 }),
  ],
})
export class Article {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.vector(3).nullable()) embedding?: number[] | null;
}

// @ts-expect-error a weight is a number
indexOf<Article>((article, index) => [index([{ column: article.title, weight: 'A' }], { type: 'fulltext' })]);

/**
 * `IndexTypeOptions` pairs a vector index `type` with a mandatory `distance` and forbids `distance`
 * everywhere else (see its doc comment) - without that explicit `never`, `VectorIndexOptions`'
 * optional `distance` would survive the intersection and silently typecheck this.
 */
@Entity()
export class NonVectorIndexWithDistance {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
}

indexOf<NonVectorIndexWithDistance>((nonVectorIndexWithDistance, index) => [
  index([nonVectorIndexWithDistance.title], {
    type: 'gin',
    // @ts-expect-error a non-vector index type cannot declare a distance metric
    distance: 'cosine',
  }),
]);

@Entity()
export class MissingMetric {
  @Field(f.number().id()) id?: number;
  @Field(f.vector(3).nullable()) embedding?: number[] | null;
}

// @ts-expect-error CockroachDB's native vector index needs a distance metric
indexOf<MissingMetric>((missingMetric, index) => [index([missingMetric.embedding], { type: 'vector' })]);
// @ts-expect-error ivfflat needs a distance metric
indexOf<MissingMetric>((missingMetric, index) => [index([missingMetric.embedding], { type: 'ivfflat', lists: 10 })]);
// @ts-expect-error hnsw needs a distance metric
indexOf<MissingMetric>((missingMetric, index) => [index([missingMetric.embedding], { type: 'hnsw' })]);

/**
 * Column names are checked against the decorated class, which a legacy property decorator could not do:
 * the entity type is inferred from where the returned decorator lands.
 */
@Entity({
  indexes: (post, index) => [index([{ column: post.title, order: 'desc' }, post.id])],
})
export class Post {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.references(() => Article).nullable()) articleId?: number | null;
  @ManyToOne({ entity: () => Article, references: (post) => post.articleId }) author?: Article;
}

// @ts-expect-error a column is read off the refs, never named by a string
indexOf<Post>((post, index) => [index(['title'])]);
// @ts-expect-error a relation is not a column; index its foreign key instead
indexOf<Post>((post, index) => [index([post.author])]);
// @ts-expect-error no such column in the object form either
indexOf<Post>((post, index) => [index([{ column: post.titel }])]);
// @ts-expect-error no such column
indexOf<Post>((post, index) => [index([post.titel])]);

/** `include`'s columns are the entity's too: a typo there builds nothing, the server refusing it. */
@Entity({
  indexes: (covering, index) => [index([covering.title], { include: [covering.id] })],
})
export class Covering {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
}

// @ts-expect-error `include` reads its columns off the refs, never names them by a string
indexOf<Covering>((covering, index) => [index([covering.title], { include: ['id'] })]);
// @ts-expect-error `include` stores columns, never an expression
indexOf<Covering>((covering, index) => [index([covering.title], { include: [sql`lower(title)`] })]);
// @ts-expect-error no such column to include
indexOf<Covering>((covering, index) => [index([covering.title], { include: [covering.idd] })]);

/**
 * A partial index's predicate is a `QueryWhere` over the entity's own fields, or SQL reading them off
 * refs, as an expression entry does. A typo, a relation, or what DDL cannot carry fails.
 */
@Entity({
  indexes: (softDeleted, index) => [
    index([{ column: sql`lower(title)`, order: 'desc' }]),
    index([softDeleted.title], { where: sql`${softDeleted.deletedAt} IS NULL` }),
    index([softDeleted.title], { where: { deletedAt: null } }),
  ],
})
export class SoftDeleted {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.date().nullable()) deletedAt?: Date | null;
  @Field(f.references(() => Article).nullable()) articleId?: number | null;
  @ManyToOne({ entity: () => Article, references: (softDeleted) => softDeleted.articleId }) author?: Article;
}

// @ts-expect-error an expression's refs are the entity's fields
indexOf<SoftDeleted>((softDeleted, index) => [index([sql`lower(${softDeleted.titel})`])]);
// @ts-expect-error an expression is raw read off the list's refs, never a callback
indexOf<SoftDeleted>((softDeleted, index) => [index([() => sql`lower(title)`])]);
indexOf<SoftDeleted>((softDeleted, index) => [
  index([softDeleted.title], {
    // @ts-expect-error the refs are the entity's fields
    where: sql`${softDeleted.deletdAt} IS NULL`,
  }),
]);
// @ts-expect-error a predicate is a QueryWhere or raw, never a string
indexOf<SoftDeleted>((softDeleted, index) => [index([softDeleted.title], { where: 'title IS NOT NULL' })]);
// @ts-expect-error DDL has no full-text search
indexOf<SoftDeleted>((softDeleted, index) => [index([softDeleted.title], { where: { $text: { $value: 'x' } } })]);
// @ts-expect-error a relation has no column to test
indexOf<SoftDeleted>((softDeleted, index) => [index([softDeleted.title], { where: { author: { id: 1 } } })]);
// @ts-expect-error no such field in the predicate
indexOf<SoftDeleted>((softDeleted, index) => [index([softDeleted.title], { where: { deletdAt: null } })]);

/**
 * A path inside a JSON column is read off its ref the way a `$where` key spells it, so it is checked against the
 * column's payload and a rename reaches it. It matters more here than anywhere else in the index API: a misspelled
 * path still builds a valid index, one no query matches. A path that is not text says how its queries compare it,
 * since a number read as text sorts as text; an array type indexes each element.
 */
@Entity({
  indexes: (jsonIndexed, index) => [
    index([jsonIndexed.kind.then]),
    index([jsonIndexed.loose['anything']['at']['all'], { column: jsonIndexed.loose['score'], type: Number }]),
    index([jsonIndexed.kind], { type: 'gin' }),
    index([{ column: jsonIndexed.tags, type: [String], charLength: 64 }]),
    index([{ column: jsonIndexed.kind.ids, type: [Number] }]),
    index([{ column: jsonIndexed.kind.theme.count, type: Number }]),
    index([{ column: jsonIndexed.kind.rating, type: Number }]),
    index([{ column: jsonIndexed.kind.theme.color, charLength: 32 }]),
    index([jsonIndexed.kind.theme.color]),
  ],
})
export class JsonIndexed {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.json().nullable()) kind?: Json<{
    theme: { color: string; count: number };
    rating: number;
    ids: number[];
    as: string;
    then: string;
    toString: string;
  }> | null;
  @Field(f.json().nullable()) tags?: Json<string[]> | null;
  @Field(f.json().nullable()) loose?: Json | null;
}

// @ts-expect-error `Object`'s own names are every ref's, so a payload key of one is out of reach
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.kind.toString])]);
// @ts-expect-error `as` is the ref's own, so a payload key of that name is out of reach
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.kind.as])]);
// @ts-expect-error a plain column is read as what it holds
indexOf<JsonIndexed>((jsonIndexed, index) => [index([{ column: jsonIndexed.title, type: String }])]);
// @ts-expect-error an object is no value an index can key
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.kind.theme])]);
// @ts-expect-error an array's elements need their type
indexOf<JsonIndexed>((jsonIndexed, index) => [index([{ column: jsonIndexed.kind.ids }])]);
// @ts-expect-error an array type indexes elements, and this path holds one string
indexOf<JsonIndexed>((jsonIndexed, index) => [index([{ column: jsonIndexed.kind.theme.color, type: [String] }])]);
// @ts-expect-error the type is how the queries compare the path, which is a number
indexOf<JsonIndexed>((jsonIndexed, index) => [index([{ column: jsonIndexed.kind.rating, type: String }])]);
// @ts-expect-error likewise in the object form
indexOf<JsonIndexed>((jsonIndexed, index) => [index([{ column: jsonIndexed.kind.rating }])]);
// @ts-expect-error a number read as text sorts as text, so its type is stated
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.kind.rating])]);
// @ts-expect-error not a JSON column, so it has no path
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.title.x])]);
// @ts-expect-error typo in the root segment
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.kind.thema.color])]);
// @ts-expect-error typo in the leaf segment
indexOf<JsonIndexed>((jsonIndexed, index) => [index([jsonIndexed.kind.theme.colour])]);
