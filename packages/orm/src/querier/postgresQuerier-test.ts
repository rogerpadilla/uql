import { expect, onTestFinished } from 'vitest';
import { Entity, Id, removeEntity } from '../entity/index.js';

import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';
import { PgLikeQuerierIt } from './pgLikeQuerier-test.js';

/**
 * PostgreSQL proper, whichever driver reaches it (node-`pg`, Neon, PGlite, Bun SQL): two drivers disagreeing
 * here is a bug in one of them, so a driver suite adds its pool and nothing else.
 */
export class PostgresQuerierIt extends PgLikeQuerierIt {
  /** pgvector's extension exists before the fixture DDL declares a vector column. */
  override async recreateTables(querier: AbstractSqlQuerier) {
    await querier.run`CREATE EXTENSION IF NOT EXISTS vector`;
    await super.recreateTables(querier);
  }

  /** A catalog that does not know the table answers no row, which is nothing counted. */
  async shouldEstimateNoRowsForATableThatDoesNotExist() {
    @Entity({ name: 'uql_never_created' })
    class NeverCreated {
      @Id({ type: Number }) id?: number;
    }
    onTestFinished(() => {
      removeEntity(NeverCreated);
    });

    expect(await this.querier.estimatedCount(NeverCreated)).toBe(0);
  }
}
