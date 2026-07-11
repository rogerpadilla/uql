import { types } from 'pg';

/**
 * Configures node-postgres's global INT8/FLOAT8/NUMERIC type parsers to return JS numbers instead
 * of strings. Shared by every `pg`-driver integration test (Postgres and CockroachDB use the same
 * driver and wire types). Not re-exported from `test/index.ts` so dialects that don't use `pg`
 * (MySQL, MariaDB, SQLite, Mongo) never transitively import it.
 */
export function configurePgNumericTypeParsers(): void {
  types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
  types.setTypeParser(types.builtins.FLOAT8, (value: string) => Number.parseFloat(value));
  types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));
}
