import type { Config } from 'uql-orm';
import { SqliteQuerierPool } from 'uql-orm/sqlite';
import { Todo } from './src/entities.ts';

// Opens the file through `bun:sqlite` under Bun.
export const pool = new SqliteQuerierPool('todos.db');

export default { pool, entities: [Todo] } satisfies Config;
