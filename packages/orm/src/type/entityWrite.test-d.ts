/**
 * A field declared present (`!`) is present on every read that selects it, and an insert names it, but
 * for what is filled: a single-column key, the version, and what the `filledKey` brand lists. Type-checked
 * by `bun run ts` only.
 */
import { v7 as uuidv7 } from 'uuid';
import { defineEntity, Entity, f, Field, ManyToOne, OneToMany } from '../entity/index.js';
import { filledKey, idKey, type Querier, type Type, versionKey } from '../index.js';

@Entity()
class Author {
  @Field(f.uuid().id().onInsert(uuidv7)) id!: string;
  @Field(f.string()) name!: string;
  @OneToMany({ entity: () => Article, mappedBy: (article) => article.author }) articles?: Article[];
}

@Entity()
class Article {
  @Field(f.uuid().id().onInsert(uuidv7)) id!: string;
  @Field(f.string()) slug!: string;
  @Field(f.number().default(0)) views?: number;
  @Field(f.string().nullable()) summary?: string | null;
  @Field(f.references(() => Author).nullable()) authorId?: string | null;
  @ManyToOne({ entity: () => Author, references: (article) => article.authorId }) author?: Author;
}

@Entity()
class Membership {
  [idKey]?: 'authorId' | 'groupId';
  @Field(f.uuid().id()) authorId!: string;
  @Field(f.uuid().id()) groupId!: string;
  @Field(f.string()) role!: string;
}

@Entity()
class Draft {
  [versionKey]?: 'version';
  @Field(f.number().id()) id!: number;
  @Field(f.string()) body!: string;
  @Field(f.version()) version!: number;
}

@Entity()
class Stock {
  [filledKey]?: 'units' | 'createdAt';
  @Field(f.number().id()) id!: number;
  @Field(f.string()) sku!: string;
  @Field(f.number().default(0)) units!: number;
  @Field(f.date().onInsert(() => new Date())) createdAt!: Date;
}

// @ts-expect-error a brand naming no field is a typo
@Entity()
export class Misbranded {
  [filledKey]?: 'unitz';
  @Field(f.number().id()) id!: number;
  @Field(f.number().default(0)) units!: number;
}

@Entity()
export class Unfilled {
  [filledKey]?: 'units';
  @Field(f.number().id()) id!: number;
  // @ts-expect-error the brand lets an insert leave it out, so a default has to fill it
  @Field(f.number()) units!: number;
}

const Tally = defineEntity({
  name: 'Tally',
  fields: { id: f.number().id(), label: f.string() },
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
  await querier.upsertOne(Article, { $conflict: { slug: true } }, { slug: 'a' });
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
  await querier.upsertOne(Article, { $conflict: { id: true } }, { id: 'a' });
  // @ts-expect-error ...on a defined entity alike
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

export async function aFilledFieldIsPresentOnReadAndLeftOutOnInsert() {
  await querier.insertOne(Stock, { sku: 'a' });
  await querier.insertMany(Stock, [{ sku: 'a', units: 3 }]);
  const [row] = await querier.findMany(Stock, {});
  const read: { units: number; createdAt: Date } = row;
  return read;
}

export async function anInsertStillNamesWhatTheBrandLeavesOut() {
  // @ts-expect-error `sku` is not listed
  await querier.insertOne(Stock, { units: 3 });
}
