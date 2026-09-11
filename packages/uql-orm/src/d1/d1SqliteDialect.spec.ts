import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { SqliteQuerier } from '../sqlite/sqliteQuerier.js';
import { createTables, Item, ItemTag, Tag, Tax } from '../test/index.js';
import type { Json } from '../type/index.js';
import { D1SqliteDialect } from './d1SqliteDialect.js';

/** A document with open keys, so one update can touch more of them than a D1 call takes. */
@Entity()
class Preferences {
  @Id({ type: String })
  id?: string;

  @Field({ type: 'json' })
  values?: Json<Record<string, number>>;

  @Field({ type: 'json' })
  lists?: Json<Record<string, number[]>>;
}

const dialect = new D1SqliteDialect();
const keys = Array.from({ length: 40 }, (_, at) => `k${at}`);
const wide = Object.fromEntries(keys.slice(0, 20).map((key, at) => [key, at]));

/** The most arguments any function call in `sql` takes, counted at the call's own depth, outside literals. */
function mostCallArgs(sql: string): number {
  const open: number[] = [];
  let most = 0;
  let quoted = false;
  for (let at = 0; at < sql.length; at++) {
    const char = sql[at];
    if (char === "'") {
      quoted = !quoted;
    } else if (quoted) {
      continue;
    } else if (char === '(') {
      open.push(/\w/.test(sql[at - 1] ?? '') ? 1 : 0);
    } else if (char === ')') {
      most = Math.max(most, open.pop() ?? 0);
    } else if (char === ',' && open.at(-1)) {
      open[open.length - 1]++;
    }
  }
  return most;
}

/** D1 caps a function call at 32 arguments, which a wide object or JSON update would pass in one call. */
describe('D1SqliteDialect', () => {
  /** An item and the tax it joins, read as a to-many: 44 arguments in one `json_object`. */
  it('keeps each call of a wide relation read within 32 arguments', () => {
    const ctx = dialect.createContext();
    dialect.find(ctx, Tag, { $populate: { items: { $populate: { tax: true } } } });

    expect(mostCallArgs(ctx.sql)).toBeLessThanOrEqual(32);
  });

  it('keeps each call of a wide JSON update within 32 arguments', () => {
    const ctx = dialect.createContext();
    const lists = Object.fromEntries(keys.slice(0, 20).map((key) => [key, 1]));
    dialect.update(
      ctx,
      Preferences,
      { $where: { id: 'p' } },
      { values: { $set: wide, $unset: keys.slice(20) }, lists: { $push: lists } },
    );

    expect(mostCallArgs(ctx.sql)).toBeLessThanOrEqual(32);
  });

  /** The split calls read and write what one call would, on a real SQLite. */
  it('reads and updates through the split calls', async () => {
    const db = new BetterSqlite3(':memory:');
    await createTables(new SqliteQuerier(db, new SqliteDialect()));
    const d1 = new SqliteQuerier(db, dialect);
    const taxId = await d1.insertOne(Tax, { name: 'VAT', percentage: 16 });
    const itemId = await d1.insertOne(Item, { name: 'pen', taxId });
    const tagId = await d1.insertOne(Tag, { name: 'office' });
    await d1.insertOne(ItemTag, { itemId, tagId });
    await d1.insertOne(Preferences, { id: 'p', values: {} });

    await d1.updateOneById(Preferences, 'p', { values: { $set: wide } });
    await d1.updateOneById(Preferences, 'p', { values: { $unset: keys.slice(2) } });
    const [tag] = await d1.findMany(Tag, { $where: { id: tagId }, $populate: { items: { $populate: { tax: true } } } });

    expect(tag.items).toMatchObject([{ id: itemId, name: 'pen', tax: { id: taxId, name: 'VAT', percentage: 16 } }]);
    expect(await d1.findOneById(Preferences, 'p', { $select: { values: true } })).toEqual({ values: { k0: 0, k1: 1 } });
    db.close();
  });
});
