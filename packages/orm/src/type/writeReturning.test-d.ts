/**
 * What a write resolves to: its ids or its count, or, with `returning`, the rows narrowed to the fields it
 * lists, whose keys are checked like a `$select`'s, or every field for `returning: true`. Type-checked by `bun run ts` only.
 */
import type { Querier, QuerierPool, WrittenId } from '../index.js';

class Account {
  id!: number;
  email!: string;
  createdAt?: Date | null;
}

declare const querier: Querier;
declare const pool: QuerierPool;

export async function writesWithoutReturning() {
  const id: WrittenId<Account> | undefined = await querier.insertOne(Account, { email: 'a' });
  const ids: (WrittenId<Account> | undefined)[] = await querier.insertMany(Account, [{ email: 'a' }]);
  const changed: number = await querier.updateMany(Account, { $where: { id: 1 } }, { email: 'b' });
  const deleted: number = await pool.deleteOneById(Account, 1);
  const unread: number = await pool.updateMany(Account, { $where: { id: 1 } }, { email: 'b' }, { returning: false });
  const upserted: WrittenId<Account> | undefined = await querier.upsertOne(
    Account,
    { $conflict: { email: true } },
    { email: 'a' },
  );
  return [id, ids, changed, deleted, unread, upserted];
}

export async function aMixedReturningReadsItsPositiveKeysAtMost() {
  const row = await querier.insertOne(Account, { email: 'a' }, { returning: { id: true, email: false } });
  // @ts-expect-error each key a mixed map names may be absent, since a key set cannot tell positive from negative
  row.email.trim();
  // @ts-expect-error ...nor a field it never named
  row.createdAt;
}

export async function writesReturningRows() {
  const inserted = await querier.insertOne(Account, { email: 'a' }, { returning: { id: true, createdAt: true } });
  inserted.id.toFixed();
  inserted.createdAt?.getTime();
  // @ts-expect-error a field `returning` left out
  inserted.email;

  const [updated] = await pool.updateMany(
    Account,
    { $where: { id: 1 } },
    { email: 'b' },
    { returning: { email: true } },
  );
  updated?.email.trim();

  const deleted = await querier.deleteOneById(Account, 1, { returning: { email: true } });
  deleted?.email.trim();

  const upserted = await querier.upsertOne(
    Account,
    { $conflict: { email: true } },
    { email: 'a' },
    {
      returning: { id: true },
    },
  );
  upserted.id.toFixed();
}

export async function returningTrueReadsEveryField() {
  const inserted = await querier.insertOne(Account, { email: 'a' }, { returning: true });
  inserted.id.toFixed();
  inserted.email.trim();
  inserted.createdAt?.getTime();

  const [updated] = await pool.updateMany(Account, { $where: { id: 1 } }, { email: 'b' }, { returning: true });
  updated?.email.trim();

  const upserted = await querier.upsertOne(
    Account,
    { $conflict: { email: true }, $update: {} },
    { email: 'a' },
    {
      returning: true,
    },
  );
  upserted.createdAt?.getTime();
}

export async function upsertsTakeTheEntityAsTheQuerys$entity() {
  const id: WrittenId<Account> | undefined = await querier.upsertOne(
    { $entity: Account, $conflict: { email: true } },
    { email: 'a' },
  );
  const [row] = await querier.upsertMany(
    { $entity: Account, $conflict: { email: true }, $update: {} },
    [{ email: 'a' }],
    {
      returning: true,
    },
  );
  row?.email.trim();
  // @ts-expect-error a conflict key the entity lacks
  await querier.upsertOne({ $entity: Account, $conflict: { emial: true } }, { email: 'a' });
  // @ts-expect-error a row field the entity lacks
  await querier.upsertOne({ $entity: Account, $conflict: { email: true } }, { emial: 'a' });
  return id;
}

export async function refusesAKeyTheEntityLacks() {
  // @ts-expect-error a typo'd key, beside a real one
  await querier.insertOne(Account, { email: 'a' }, { returning: { id: true, emial: true } });
  // @ts-expect-error a typo'd key alone
  await pool.saveMany(Account, [{ email: 'a' }], { returning: { emial: true } });
}
