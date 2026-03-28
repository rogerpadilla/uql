import type { PoolClient } from '@neondatabase/serverless';
import { AbstractPgQuerier } from '../postgres/abstractPgQuerier.js';
import type { PostgresDialect } from '../postgres/postgresDialect.js';

export class NeonQuerier extends AbstractPgQuerier<PoolClient, PostgresDialect> {}
