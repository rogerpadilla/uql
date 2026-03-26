import type { PoolClient } from '@neondatabase/serverless';
import { AbstractPgQuerier } from '../postgres/abstractPgQuerier.js';
import type { PostgresDialect } from '../postgres/index.js';

export class NeonQuerier extends AbstractPgQuerier<PoolClient, PostgresDialect> {}
