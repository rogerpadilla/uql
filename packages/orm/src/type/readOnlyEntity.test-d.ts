/**
 * A read-only entity takes no write at compile time, as the querier refuses one at run time: a defined entity with
 * no key is branded so, a decorated class says it with `[readOnly]`. Type-checked by `bun run ts` only.
 */
import { defineEntity, Entity, f, Field } from '../entity/index.js';
import { idKey, type Querier, type QuerierPool, readOnly, type Type, type UniversalQuerier } from '../index.js';
import type { PgQuerier } from '../postgres/pgQuerier.js';
import type { QUERIER_OPS } from './universalQuerier.js';

const Reading = defineEntity({ name: 'Reading', fields: { sensor: f.string(), value: f.number() } });

@Entity()
class Logged {
  readonly [readOnly]?: true;
  @Field(f.string()) line!: string;
}

const Noted = defineEntity({ name: 'Noted', abstract: true, fields: { note: f.string() } });
const NotedKid = defineEntity({ name: 'NotedKid', extends: Noted, fields: { id: f.number().autoIncrement() } });
const Keyed = defineEntity({ name: 'Keyed', fields: { id: f.number().autoIncrement(), label: f.string() } });
const KeyedKid = defineEntity({ name: 'KeyedKid', extends: Keyed, fields: { extra: f.string() } });

@Entity({ readOnly: true })
class Rated {
  [idKey]?: 'code';
  readonly [readOnly]?: true;
  @Field(f.string().id()) code!: string;
}

// @ts-expect-error `readOnly: true` on a class not branded so, whose writes would compile and then throw
@Entity({ readOnly: true })
class Unbranded {
  [idKey]?: 'code';
  @Field(f.string().id()) code!: string;
}

declare const querier: Querier;
declare const concrete: PgQuerier;
declare const pool: QuerierPool;
declare const fromData: Parameters<typeof defineEntity>[0];

export async function aReadOnlyEntityIsRead() {
  const rows: { sensor: string; value: number }[] = await querier.findMany(Reading, {});
  const lines = await pool.findMany(Logged, { $where: { line: 'a' } });
  const total: number = await querier.count({ $entity: Reading });
  return [rows, lines, total];
}

export async function aKeylessDefinedEntityTakesNoWrite() {
  const row = { sensor: 'a', value: 1 };

  // @ts-expect-error a read-only entity is not inserted
  await querier.insertOne(Reading, row);
  // @ts-expect-error nor many of it
  await querier.insertMany(Reading, [row]);
  // @ts-expect-error nor saved
  await querier.saveOne(Reading, row);
  // @ts-expect-error nor many of it
  await querier.saveMany(Reading, [row]);
  // @ts-expect-error nor upserted
  await querier.upsertOne(Reading, { $conflict: { sensor: true } }, row);
  // @ts-expect-error nor many of it
  await querier.upsertMany(Reading, { $conflict: { sensor: true } }, [row]);
  // @ts-expect-error nor updated
  await querier.updateMany(Reading, { $where: { sensor: 'a' } }, { value: 2 });
  // @ts-expect-error nor by id
  await querier.updateOneById(Reading, 'a', { value: 2 });
  // @ts-expect-error nor deleted
  await querier.deleteMany(Reading, { $where: { sensor: 'a' } });
  // @ts-expect-error nor by id
  await querier.deleteOneById(Reading, 'a');
  // @ts-expect-error nor restored
  await querier.restoreMany(Reading, { $where: { sensor: 'a' } });
  // @ts-expect-error nor by id
  await querier.restoreOneById(Reading, 'a');
}

export async function itTakesNoneAsTheQuerysEntityEither() {
  // @ts-expect-error a read-only entity is not updated
  await querier.updateMany({ $entity: Reading, $where: { sensor: 'a' } }, { value: 2 });
  // @ts-expect-error nor deleted
  await querier.deleteMany({ $entity: Reading, $where: { sensor: 'a' } });
  // @ts-expect-error nor upserted
  await querier.upsertOne({ $entity: Reading, $conflict: { sensor: true } }, { sensor: 'a', value: 1 });
  // @ts-expect-error nor restored
  await querier.restoreMany({ $entity: Reading, $where: { sensor: 'a' } });
}

export async function aBrandedClassTakesNoWriteOnAPoolEither() {
  // @ts-expect-error a class branded read-only is not inserted
  await pool.insertOne(Logged, { line: 'a' });
  // @ts-expect-error nor deleted
  await pool.deleteMany(Logged, { $where: { line: 'a' } });
  // @ts-expect-error nor one declared read-only beside its brand
  await pool.insertOne(Rated, { code: 'a' });
  return pool.findOneById(Unbranded, 'a');
}

export async function aConcreteQuerierTakesNoWriteEither() {
  // @ts-expect-error a querier's own class, as a pool's transaction hands it, takes no write to it either
  await concrete.insertOne(Reading, { sensor: 'a', value: 1 });
  // @ts-expect-error nor an update
  await concrete.updateMany(Reading, { $where: { sensor: 'a' } }, { value: 2 });
  // @ts-expect-error nor a delete
  await concrete.deleteMany(Reading, {});
  // @ts-expect-error nor a restore
  await concrete.restoreMany({ $entity: Reading, $where: { sensor: 'a' } });
  return concrete.findMany(Reading, {});
}

export async function aKeyedEntityIsWrittenItsKeyItsOwnOrItsBases() {
  await querier.insertOne(NotedKid, { note: 'a' });
  await querier.insertOne(KeyedKid, { label: 'a', extra: 'b' });
  await querier.deleteMany(Keyed, { $where: { label: 'a' } });
}

const Rate = defineEntity({ name: 'Rate', readOnly: true, fields: { code: f.string().id(), value: f.number() } });
const RateKid = defineEntity({ name: 'RateKid', extends: Rate, fields: { note: f.string() } });

export async function aKeyedEntityDeclaredReadOnlyIsReadByKeyAndNeverWritten() {
  const rate: { code: string; value: number } | undefined = await querier.findOneById(Rate, 'eur');

  // @ts-expect-error an entity declared read-only is not inserted
  await querier.insertOne(Rate, { code: 'usd', value: 1 });
  // @ts-expect-error nor updated by its key
  await querier.updateOneById(Rate, 'eur', { value: 2 });
  await querier.insertOne(RateKid, { code: 'usd', value: 1, note: 'a' });
  return rate;
}

export async function anEntityDefinedFromDataIsWritten() {
  const Dynamic = defineEntity(fromData);
  await querier.deleteMany(Dynamic, {});
}

/** The methods `QUERIER_OPS` says write that still take any entity, a read-only one included: none. */
type UnguardedWrite = {
  [K in keyof UniversalQuerier]: (typeof QUERIER_OPS)[K] extends readonly ['read']
    ? never
    : Type<Logged> extends Parameters<UniversalQuerier[K]>[0]
      ? K
      : never;
}[keyof UniversalQuerier];

export const everyWriteIsGuarded: [UnguardedWrite] extends [never] ? true : UnguardedWrite = true;
