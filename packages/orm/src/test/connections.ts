/**
 * The databases `docker-compose.yml` serves. Functions, so no two pools share one options object; each
 * takes the database, the shared one unless a file changing the schema names its own (AGENTS.md).
 */
export const postgresConnection = (database = 'test') => ({
  host: '0.0.0.0',
  port: 5442,
  user: 'test',
  password: 'test',
  database,
});

export const cockroachConnection = (database = 'defaultdb') => ({
  host: '0.0.0.0',
  port: 26257,
  user: 'root',
  database,
});

export const mysqlConnection = (database = 'test') => ({
  host: '0.0.0.0',
  port: 3316,
  user: 'test',
  password: 'test',
  database,
});

export const mariadbConnection = (database = 'test') => ({
  host: '0.0.0.0',
  port: 3326,
  user: 'test',
  password: 'test',
  database,
  connectionLimit: 5,
});

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
