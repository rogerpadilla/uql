/**
 * A field declared present (`!`) is present on every read that selects it, and an insert names it, but
 * for what is filled: `_id`, the version, and what the `filledKey` brand lists. Type-checked
 * by `bun run ts` only.
 */
import { v7 as uuidv7 } from 'uuid';
import { defineEntity, Entity, f, Field, ManyToOne, OneToMany } from '../entity/index.js';
import { filledKey, idKey, type Querier, type Type, versionKey } from '../index.js';

@Entity()
class Author {
  [filledKey]?: 'id';
  @Field(f.uuid().id().onInsert(uuidv7)) id!: string;
  @Field(f.string()) name!: string;
  @OneToMany({ entity: () => Article, mappedBy: (article) => article.author }) articles?: Article[];
}

@Entity()
class Article {
  [filledKey]?: 'id';
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
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string()) body!: string;
  @Field(f.version()) version!: number;
}

@Entity()
class Stock {
  [filledKey]?: 'id' | 'units' | 'createdAt';
  @Field(f.number().autoIncrement()) id!: number;
  @Field(f.string()) sku!: string;
  @Field(f.number().default(0)) units!: number;
  @Field(f.date().onInsert(() => new Date())) createdAt!: Date;
}

// @ts-expect-error a brand naming no field is a typo
@Entity()
export class Misbranded {
  [filledKey]?: 'unitz';
  @Field(f.number().autoIncrement()) id!: number;
  @Field(f.number().default(0)) units!: number;
}

@Entity()
export class Unfilled {
  [filledKey]?: 'units';
  @Field(f.number().autoIncrement()) id!: number;
  // @ts-expect-error the brand lets an insert leave it out, so a default has to fill it
  @Field(f.number()) units!: number;
}

const Tally = defineEntity({
  name: 'Tally',
  fields: { id: f.number().autoIncrement(), label: f.string() },
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

/** A key nothing fills is the caller's to write: only a generator, a default or `onInsert` lets an insert leave it out. */
const Registration = defineEntity({
  name: 'Registration',
  fields: {
    registrationHash: f.text().id(),
    passwordHash: f.text(),
    code: f.text(),
    email: f.text(),
    expiresAt: f.date(),
  },
});
const SerialKey = defineEntity({ name: 'SerialKey', fields: { id: f.number().autoIncrement(), code: f.text() } });
const WideKey = defineEntity({ name: 'WideKey', fields: { id: f.bigint().autoIncrement(), code: f.text() } });
const FilledByApp = defineEntity({
  name: 'FilledByApp',
  fields: {
    id: f
      .uuid()
      .id()
      .onInsert(() => crypto.randomUUID()),
    code: f.text(),
  },
});
const DefaultedKey = defineEntity({ name: 'DefaultedKey', fields: { id: f.uuid().id().default('x'), code: f.text() } });
const SuppliedKey = defineEntity({
  name: 'SuppliedKey',
  fields: { id: f.number().id(), code: f.text() },
});
const FilledSuppliedKey = defineEntity({
  name: 'FilledSuppliedKey',
  fields: {
    id: f
      .number()
      .id()
      .onInsert(() => 1),
    code: f.text(),
  },
});
const MongoKey = defineEntity({ name: 'MongoKey', fields: { _id: f.string().id(), code: f.text() } });

@Entity()
class DecoratedRequiredKey {
  @Field(f.text().id()) id!: string;
  @Field(f.text()) code!: string;
}

@Entity()
class DecoratedOptionalKey {
  @Field(f.uuid().id()) id?: string;
  @Field(f.text()) code!: string;
}

@Entity()
class DecoratedNumericKey {
  @Field(f.number().autoIncrement()) id!: number;
  @Field(f.text()) code!: string;
}

@Entity()
class DecoratedFilledKey {
  [filledKey]?: 'id';
  @Field(f.number().autoIncrement()) id!: number;
  @Field(f.text()) code!: string;
}

@Entity()
class SuppliedKeyRequired {
  @Field(f.number().id()) id!: number;
  @Field(f.text()) code!: string;
}

@Entity()
export class Tenant {
  @Field(f.number().autoIncrement()) id?: number;
}

@Entity()
class SharedKeyRequired {
  @Field(f.references(() => Tenant).id()) id!: number;
  @Field(f.text()) code!: string;
}

@Entity()
export class SuppliedKeyOptional {
  // @ts-expect-error nothing fills it, so it cannot read as one an insert may leave out
  @Field(f.number().id()) id?: number;
}

@Entity()
export class SharedKeyOptional {
  // @ts-expect-error ...nor where the key is another row's
  @Field(f.references(() => Tenant).id()) id?: number;
}

@Entity()
export class SuppliedKeyListed {
  [filledKey]?: 'id';
  // @ts-expect-error the brand lets an insert leave it out, so something has to fill it
  @Field(f.number().id()) id!: number;
}

@Entity()
export class FilledSuppliedKeyOptional {
  @Field(
    f
      .number()
      .id()
      .onInsert(() => 1),
  )
  id?: number;
}

export async function aKeyNothingFillsIsRequiredOnInsert(querier: Querier) {
  const row = { code: '123', email: 'a@uql-orm.dev', expiresAt: new Date(), passwordHash: '123456789' };
  // @ts-expect-error nothing fills `registrationHash`
  await querier.insertOne(Registration, row);
  // @ts-expect-error each row of a batch alike
  await querier.insertMany(Registration, [row]);
  // @ts-expect-error and where an upsert may insert
  await querier.upsertOne(Registration, { $conflict: { email: true } }, row);
  // @ts-expect-error and where a save inserts
  await querier.saveOne(Registration, row);
  await querier.insertOne(Registration, { ...row, registrationHash: 'h' });
  await querier.insertMany(Registration, [{ ...row, registrationHash: 'h' }]);
  // @ts-expect-error a `!` property nothing fills
  await querier.insertOne(DecoratedRequiredKey, { code: 'x' });

  // @ts-expect-error a numeric key is the caller's unless it says otherwise
  await querier.insertOne(SuppliedKey, { code: 'x' });
  await querier.insertOne(SuppliedKey, { id: 1, code: 'x' });
  await querier.insertOne(FilledSuppliedKey, { code: 'x' });
  await querier.insertOne(SerialKey, { code: 'x' });
  await querier.insertOne(WideKey, { code: 'x' });
  await querier.insertOne(FilledByApp, { code: 'x' });
  await querier.insertOne(DefaultedKey, { code: 'x' });
  await querier.insertOne(MongoKey, { code: 'x' });
  await querier.insertOne(DecoratedOptionalKey, { code: 'x' });
  await querier.insertOne(DecoratedFilledKey, { code: 'x' });
  // @ts-expect-error a `!` key is the caller's unless `filledKey` lists it
  await querier.insertOne(DecoratedNumericKey, { code: 'x' });
  await querier.insertOne(DecoratedNumericKey, { id: 1, code: 'x' });
  // @ts-expect-error ...on a decorated class too
  await querier.insertOne(SuppliedKeyRequired, { code: 'x' });
  // @ts-expect-error a key shared with another row, on a decorated class
  await querier.insertOne(SharedKeyRequired, { code: 'x' });
}
