import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { SqliteLikeQuerierIt } from '../querier/sqliteLikeQuerier-test.js';
import { createSpec, type SpecRequirements, tursoServerUrl } from '../test/index.js';
import { TursoQuerierPool } from './tursoQuerierPool.js';

/** `end()` closes nothing: each querier holds a session of its own, which only its release ends. */
class TursoQuerierPoolIt extends SqlQuerierPoolIt {
  requirements(): SpecRequirements<this> {
    return { shouldRefuseAStatementAfterEnd: false };
  }
}

// Turso Cloud as it runs by default, libSQL's server, reached through a session per querier.
createSpec(new SqliteLikeQuerierIt(new TursoQuerierPool({ url: tursoServerUrl })));
createSpec(new TursoQuerierPoolIt(() => new TursoQuerierPool({ url: tursoServerUrl })));
