import type { PoolClient } from 'pg';
import { AbstractPgQuerier } from './abstractPgQuerier.js';
import type { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractPgQuerier<PoolClient, PostgresDialect> {}
