import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec } from '../test/index.js';
import { TursoLocalQuerierPool } from './tursoLocalQuerierPool.js';

// Unlike libsql, `:memory:` works here: the engine keeps a single connection, and transactions are
// plain `BEGIN`/`COMMIT` statements on it rather than a separate one, so no temp file is needed.
export class TursoLocalQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new TursoLocalQuerierPool(':memory:'));
  }
  /**
   * SQLite has no DECIMAL type. NUMERIC affinity converts the literal to a float on write, so the
   * exact digits are lost in the database, not on the way back out.
   */
  protected override expectedExactDecimal(): number {
    return 12345678901234567000;
  }

  override async beforeEach() {
    await super.beforeEach();
    await this.querier.run('PRAGMA foreign_keys = ON');
  }
}

createSpec(new TursoLocalQuerierIt());
