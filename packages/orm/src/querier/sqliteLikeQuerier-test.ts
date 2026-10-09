import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * The SQLite family, whichever driver or build reaches it (better-sqlite3, `node:sqlite`, libSQL, Turso),
 * which has no DECIMAL type: NUMERIC affinity converts a wide decimal to a float *on write*, so the digits
 * are gone in the database before anything on the read side could keep them.
 */
export class SqliteLikeQuerierIt extends VectorQuerierIt {
  protected override expectedExactDecimal() {
    return '12345678901234500000';
  }
}
