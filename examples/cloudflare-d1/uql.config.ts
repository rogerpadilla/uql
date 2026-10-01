import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from 'uql-orm';
import { NodeSqliteQuerierPool } from 'uql-orm/sqlite';
import { Todo } from './src/entities.ts';

/**
 * The SQLite file behind wrangler's local D1, which `wrangler d1 migrations apply --local` keeps current:
 * uql diffs the entities against it, and wrangler applies the SQL to D1. Before the first apply there is
 * none, and an empty database is what nothing applied looks like. The path is wrangler's own layout.
 */
function localD1File(): string {
  const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  const files = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    : [];
  if (files.length > 1) {
    throw new Error(`Expected one local D1 database in ${dir}, found ${files.length}: delete the stale ones.`);
  }
  return files[0] ? join(dir, files[0]) : ':memory:';
}

export default {
  pool: new NodeSqliteQuerierPool(localD1File()),
  entities: [Todo],
} satisfies Config;
