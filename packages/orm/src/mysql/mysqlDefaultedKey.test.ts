import { describe, expect, it } from 'vitest';
import { Entity, f, Field } from '../entity/index.js';
import { mysqlConnection } from '../test/index.js';
import { syncedPool } from '../test/sqlPools.js';
import { sql } from '../util/sql.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

/** A default differing per row, so a batch cannot share one evaluation. */
@Entity({ name: 'MySqlDefaultedKey' })
class MySqlDefaultedKey {
  @Field(
    f
      .string()
      .length(36)
      .id()
      .default(sql`(uuid())`),
  )
  id?: string;
  @Field(f.string()) code!: string;
}

/** Filled by nothing the entity declares. */
@Entity({ name: 'MySqlUnreportedKey' })
class MySqlUnreportedKey {
  @Field(f.string().length(36).id()) id?: string;
  @Field(f.string()) code!: string;
}

describe('a key MySQL defaults per row', () => {
  const pool = syncedPool(() => new MySql2QuerierPool(mysqlConnection()), [MySqlDefaultedKey, MySqlUnreportedKey]);

  it('should report each row its own key', async () => {
    const ids = await pool().insertMany(MySqlDefaultedKey, [{ code: 'a' }, { id: 'named', code: 'b' }, { code: 'c' }]);
    expect(ids[1]).toBe('named');
    expect(new Set(ids).size).toBe(3);
    expect(await pool().findOneById(MySqlDefaultedKey, ids[2])).toEqual({ id: ids[2], code: 'c' });
  });

  it('should refuse a key it could not report, before writing the row', async () => {
    await expect(pool().insertOne(MySqlUnreportedKey, { code: 'a' })).rejects.toThrow(
      "'MySqlUnreportedKey.id' is filled by nothing",
    );
    expect(await pool().count(MySqlUnreportedKey, {})).toBe(0);
  });
});
