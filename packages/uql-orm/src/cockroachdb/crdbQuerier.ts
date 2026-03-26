import type { PoolClient } from 'pg';
import { AbstractPgQuerier } from '../postgres/abstractPgQuerier.js';
import type { CockroachDialect } from './cockroachDialect.js';

/**
 * Querier for CockroachDB utilizing the standard `pg` PoolClient.
 */
export class CrdbQuerier extends AbstractPgQuerier<PoolClient, CockroachDialect> {}
