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

/** The libSQL servers, one per suite reaching them, as Turso Cloud and a self-hosted sqld are reached. */
export const libsqlServerUrl = 'http://127.0.0.1:8090';
export const tursoServerUrl = 'http://127.0.0.1:8091';

/** `directConnection`, since the one-node replica set names a host only the container resolves. */
export const mongoUri = (database: string) => `mongodb://127.0.0.1:27027/${database}?directConnection=true`;
