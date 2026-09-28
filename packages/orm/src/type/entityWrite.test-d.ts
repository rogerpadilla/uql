/**
 * A field declared present (`!`) is present on every read that selects it, and an insert names it, but
 * for what uql fills: a single-column key and the version. Type-checked by `bun run ts` only.
 */
import { v7 as uuidv7 } from 'uuid';
import { defineEntity, Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { idKey, type Querier, type Type, versionKey } from '../index.js';

@Entity()
class Author {
  @Id({ type: 'uuid', onInsert: uuidv7 }) id!: string;
  @Field({ type: String, nullable: false }) name!: string;
  @OneToMany({ entity: () => Article, mappedBy: (article) => article.author }) articles?: Article[];
}

@Entity()
class Article {
  @Id({ type: 'uuid', onInsert: uuidv7 }) id!: string;
  @Field({ type: String, nullable: false }) slug!: string;
  @Field({ type: Number, nullable: false, defaultValue: 0 }) views?: number;
  @Field({ type: String }) summary?: string | null;
  @Field({ references: () => Author }) authorId?: string | null;
  @ManyToOne({ entity: () => Author, references: (article) => article.authorId }) author?: Author;
}

@Entity()
class Membership {
  [idKey]?: 'authorId' | 'groupId';
  @Id({ type: 'uuid' }) authorId!: string;
  @Id({ type: 'uuid' }) groupId!: string;
  @Field({ type: String, nullable: false }) role!: string;
}

@Entity()
class Draft {
  [versionKey]?: 'version';
  @Id({ type: Number }) id!: number;
  @Field({ type: String, nullable: false }) body!: string;
  @Field({ type: Number, version: true }) version!: number;
}

class Tally {
  id!: number;
  label!: string;
}

defineEntity(Tally, {
  fields: { id: { type: Number, isId: true }, label: { type: String, nullable: false } },
});

declare const querier: Querier;

export async function aReadHasWhatTheEntityDeclaresPresent() {
  const [row] = await querier.findMany(Article, { $select: { id: true, slug: true } });
  const read: { id: string; slug: string } = row;
  // @ts-expect-error a field the projection left out
  row.views;
  const [whole] = await querier.findMany(Article, {});
  // @ts-expect-error an optional field stays optional
  const views: number = whole.views;
  return [read, views];
}

export async function anInsertLeavesOutWhatUqlFills() {
  await querier.insertOne(Article, { slug: 'a' });
  await querier.insertMany(Article, [{ slug: 'a' }, { id: 'b', slug: 'b', views: 1 }]);
  await querier.upsertOne(Article, { slug: true }, { slug: 'a' });
  await querier.saveMany(Article, [{ slug: 'a' }, { id: 'b', slug: 'b' }]);
  await querier.insertOne(Draft, { body: 'a' });
  await querier.insertOne(Tally, { label: 'a' });
}

export async function anInsertNamesTheRest() {
  // @ts-expect-error `slug` is present on every read, and nothing fills it
  await querier.insertOne(Article, {});
  // @ts-expect-error ...in a batch too
  await querier.insertMany(Article, [{ views: 1 }]);
  // @ts-expect-error ...and where an upsert may insert
  await querier.upsertOne(Article, { id: true }, { id: 'a' });
  // @ts-expect-error ...on an entity `defineEntity` declares alike
  await querier.insertOne(Tally, {});
  // @ts-expect-error a composite key is the references the row is made of, which the caller supplies
  await querier.insertOne(Membership, { authorId: 'a', role: 'owner' });
  await querier.insertOne(Membership, { authorId: 'a', groupId: 'b', role: 'owner' });
}

export async function aRelatedRowIsWrittenTheSameWay() {
  await querier.insertOne(Author, { name: 'a', articles: [{ slug: 'b' }] });
  // @ts-expect-error a related row names its `slug` as a top-level one does
  await querier.insertOne(Author, { name: 'a', articles: [{ views: 1 }] });
}

export async function anUpdateStillSaysWhichVersionItRead() {
  await querier.updateOneById(Draft, 1, { body: 'b', version: 1 });
  // @ts-expect-error the version the update read
  await querier.updateOneById(Draft, 1, { body: 'b' });
}

/** A generic row still writes as itself, which a wrapper around the whole write would refuse. */
export function aGenericRowIsAWrite<E extends object>(entity: Type<E>, row: E) {
  return querier.insertOne(entity, row);
}
