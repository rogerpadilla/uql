import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { SqliteSchemaIntrospector } from './introspection/sqliteIntrospector.js';
import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync({
  name: 'SQLite',
  createPool: () => new Sqlite3QuerierPool(':memory:'),
  createIntrospector: (pool) => new SqliteSchemaIntrospector(pool),
  dialect: new SqliteDialect(),
  serialIdColumn: '`id` INTEGER PRIMARY KEY AUTOINCREMENT',
  textType: 'TEXT',
  doubleType: 'DOUBLE',
  keyColumnType: 'INTEGER',
});
