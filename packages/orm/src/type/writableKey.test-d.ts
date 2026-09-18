/**
 * A field the database writes is declared `readonly`, and a write payload leaves it out: its value
 * never reaches the database, so the type should not let a caller think it does. Reads are untouched.
 * Type-checked by `bun run ts` only.
 */
import { Entity, Field, Id, OneToMany } from '../entity/index.js';
import type { Querier } from '../index.js';

@Entity()
class Line {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Basket, type: Number }) basketId?: number | null;
  @Field({ type: Number }) amount?: number | null;
}

@Entity()
class Basket {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) label?: string | null;

  @OneToMany({ entity: () => Line, mappedBy: (line) => line.basketId })
  lines?: Line[];

  @Field({ computed: (basket) => basket.lines.count() })
  readonly lineCount?: number;

  @Field({ type: Number, computed: (basket) => basket.id, stored: true })
  readonly mirroredId?: number | null;
}

declare const querier: Querier;

export async function writesLeaveDatabaseWrittenFieldsOut() {
  await querier.insertOne(Basket, { label: 'a' });
  await querier.updateOneById(Basket, 1, { label: 'b' });
  await querier.saveOne(Basket, { id: 1, label: 'c' });

  // @ts-expect-error a relation aggregate is written by the database, never by a caller
  await querier.insertOne(Basket, { label: 'a', lineCount: 3 });
  // @ts-expect-error ...on an update too
  await querier.updateOneById(Basket, 1, { lineCount: 3 });
  // @ts-expect-error ...and a stored generated column the same way
  await querier.insertOne(Basket, { label: 'a', mirroredId: 1 });
  // @ts-expect-error ...including through upsert
  await querier.upsertOne(Basket, { id: true }, { id: 1, label: 'a', lineCount: 3 });
}

export async function readsAreUntouched() {
  const found = await querier.findOne(Basket, { $select: { label: true, lineCount: true } });
  const count: number | undefined = found?.lineCount;
  await querier.findMany(Basket, { $where: { lineCount: { $gt: 2 } }, $sort: { lineCount: -1 } });
  return count;
}
