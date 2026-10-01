import type { Config } from 'uql-orm';
import { NodeSqliteQuerierPool } from 'uql-orm/sqlite';
import { Todo } from './src/entities';

export default {
  pool: new NodeSqliteQuerierPool('todos.db'),
  entities: [Todo],
} satisfies Config;
