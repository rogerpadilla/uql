import type { Config } from 'uql-orm';
import { NodeSqliteQuerierPool } from 'uql-orm/sqlite';
import { Todo } from './src/entities.ts';

export const pool = new NodeSqliteQuerierPool('todos.db');

export default { pool, entities: [Todo] } satisfies Config;
