/**
 * An abstract base is never a table, so a query or write on it is refused at compile time. Type-checked by
 * `bun run ts` only.
 */
import type { ClientQuerier } from '../browser/type/clientQuerier.js';
import { defineEntity, Entity, f, Field, getEntities, ManyToOne } from '../entity/index.js';
import type { Querier } from '../index.js';
import { currentTimestamp } from '../util/index.js';

@Entity({ abstract: true })
export abstract class StampedBase {
  @Field(f.date().nullable()) at?: Date | null;
}

@Entity()
export class Post extends StampedBase {
  @Field(f.number().id()) id?: number;
}

declare const querier: Querier;

export async function aConcreteEntityIsQueried() {
  await querier.count(Post);
  await querier.findMany(Post, {});
  await querier.findMany({ $entity: Post });
}

export async function anAbstractBaseIsNotQueried() {
  // @ts-expect-error an abstract base is not a table, so it cannot be queried
  await querier.count(StampedBase);
  // @ts-expect-error an abstract base is not a table, so it cannot be queried
  await querier.findMany(StampedBase, {});
  // @ts-expect-error an abstract base is not a table, so it cannot be queried
  await querier.findMany({ $entity: StampedBase });
  // @ts-expect-error an abstract base is not a table, so it cannot be written
  await querier.deleteMany(StampedBase, {});
}

export const StampedSchema = defineEntity({
  name: 'StampedSchema',
  abstract: true,
  fields: { at: f.date().nullable() },
}).indexes((stamped, index) => [index([stamped.at])]);

export const Visit = defineEntity({ name: 'Visit', extends: StampedSchema, fields: { id: f.number().id() } });

export async function aSchemaBaseIsNotQueried() {
  await querier.count(Visit);
  // @ts-expect-error a schema's abstract base is not a table, so it cannot be queried
  await querier.count(StampedSchema);
}

@Entity()
export class Comment {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error an abstract base has no table, so a relation cannot join to it
  @ManyToOne({ entity: () => StampedBase, references: (comment) => comment.id }) stamp?: StampedBase;
}
void Comment;

/** What the registry hands over is a table, so it reads as one. */
export async function aRegisteredEntityIsQueried() {
  for (const entity of getEntities()) {
    await querier.count(entity);
  }
}

declare const client: ClientQuerier;

export async function aBrowserClientRefusesAnAbstractBase() {
  await client.insertOne(Post, {});
  // @ts-expect-error an abstract base is not a table, so it cannot be written
  await client.insertOne(StampedBase, {});
  // @ts-expect-error an abstract base is not a table, so it cannot be queried
  await client.count(StampedBase);
}

export const StampedRecord = defineEntity({
  name: 'StampedRecord',
  abstract: true,
  fields: { id: f.number().id(), createdAt: f.date().default(currentTimestamp) },
});

export const Stocked = defineEntity({
  name: 'Stocked',
  extends: StampedRecord,
  fields: { label: f.string(), stock: f.number().default(0) },
});

/** The base's filled fields and the subtype's own default are both left out of an insert. */
export async function anInheritedInsertLeavesItsFilledFieldsOut() {
  await querier.insertOne(Stocked, { label: 'x' });
}
