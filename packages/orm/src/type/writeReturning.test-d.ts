/**
 * What a write resolves to: its ids or its count, or, with `returning`, the rows narrowed to the fields it
 * lists, whose keys are checked like a `$select`'s. Type-checked by `bun run ts` only.
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
  const upserted: WrittenId<Account> | undefined = await querier.upsertOne(Account, { email: true }, { email: 'a' });
  return [id, ids, changed, deleted, upserted];
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

  const upserted = await querier.upsertOne(Account, { email: true }, { email: 'a' }, undefined, {
    returning: { id: true },
  });
  upserted.id.toFixed();
}

export async function refusesAKeyTheEntityLacks() {
  // @ts-expect-error a typo'd key, beside a real one
  await querier.insertOne(Account, { email: 'a' }, { returning: { id: true, emial: true } });
  // @ts-expect-error a typo'd key alone
  await pool.saveMany(Account, [{ email: 'a' }], { returning: { emial: true } });
}
