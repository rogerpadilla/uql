/** The databases `docker-compose.yml` serves. Functions, so no two pools share one options object. */
export const postgresConnection = (database = 'test') => ({
  host: '0.0.0.0',
  port: 5442,
  user: 'test',
  password: 'test',
  database,
});

export const cockroachConnection = () => ({ host: '0.0.0.0', port: 26257, user: 'root', database: 'defaultdb' });

export const mysqlConnection = () => ({
  host: '0.0.0.0',
  port: 3316,
  user: 'test',
  password: 'test',
  database: 'test',
});

export const mariadbConnection = () => ({
  host: '0.0.0.0',
  port: 3326,
  user: 'test',
  password: 'test',
  database: 'test',
  connectionLimit: 5,
});

/** One database per file that changes the schema, see `docker/init-mssql.sql`. */
export const mssqlConnection = (database = 'test') => ({
  server: 'localhost',
  port: 1434,
  user: 'sa',
  password: 'test!Test',
  database,
  options: { trustServerCertificate: true, encrypt: false },
});
