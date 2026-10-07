import { vector } from '@electric-sql/pglite-pgvector';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec } from '../test/index.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

// In process, no container: `extensions` makes `CREATE EXTENSION vector` resolvable, since PGlite loads an
// extension's WASM bundle at construction rather than on demand.
createSpec(new PostgresQuerierIt(new PgliteQuerierPool('memory://', { extensions: { vector } })));
