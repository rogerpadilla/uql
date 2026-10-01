import 'server-only';
import { NodeSqliteQuerierPool } from 'uql-orm/sqlite';
import './entities';

declare global {
  var uqlPool: NodeSqliteQuerierPool | undefined;
}

// The dev server re-evaluates this module on every reload; one pool per process.
export const pool = (globalThis.uqlPool ??= new NodeSqliteQuerierPool('todos.db'));
