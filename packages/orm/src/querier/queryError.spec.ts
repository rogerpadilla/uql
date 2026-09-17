import { describe, expect, it } from 'vitest';
import { type QueryErrorKind, queryErrorKind } from './queryError.js';

describe('queryErrorKind', () => {
  it.each<[string, unknown, QueryErrorKind]>([
    ['a Postgres unique violation', { code: '23505' }, 'uniqueViolation'],
    ['a Postgres foreign key violation', { code: '23503' }, 'foreignKeyViolation'],
    ['a Postgres not-null violation', { code: '23502' }, 'notNullViolation'],
    ['a Postgres check violation', { code: '23514' }, 'checkViolation'],
    ['a Postgres deadlock', { code: '40P01' }, 'retryable'],
    ['a CockroachDB retry error', { code: '40001' }, 'retryable'],
    ['a Postgres NOWAIT lock', { code: '55P03' }, 'retryable'],
    ['a Bun SQL Postgres error', { code: 'ERR_POSTGRES_SERVER_ERROR', errno: '40001' }, 'retryable'],
    ['a MySQL duplicate entry', { code: 'ER_DUP_ENTRY', errno: 1062 }, 'uniqueViolation'],
    ['a MySQL missing parent row', { errno: 1452 }, 'foreignKeyViolation'],
    ['a MySQL row still referenced', { errno: 1451 }, 'foreignKeyViolation'],
    ['a MySQL null column', { errno: 1048 }, 'notNullViolation'],
    ['a MySQL column without default', { errno: 1364 }, 'notNullViolation'],
    ['a MySQL check violation', { errno: 3819 }, 'checkViolation'],
    ['a MariaDB check violation', { errno: 4025 }, 'checkViolation'],
    ['a MySQL deadlock', { errno: 1213 }, 'retryable'],
    ['a MySQL lock wait timeout', { errno: 1205 }, 'retryable'],
    ['a MySQL NOWAIT lock', { errno: 3572 }, 'retryable'],
    ['an MSSQL primary key violation', { code: 'EREQUEST', number: 2627 }, 'uniqueViolation'],
    ['an MSSQL unique index violation', { number: 2601 }, 'uniqueViolation'],
    [
      'an MSSQL foreign key conflict',
      { number: 547, message: 'The INSERT statement conflicted with the FOREIGN KEY constraint "FK_Tax_categoryId".' },
      'foreignKeyViolation',
    ],
    [
      'an MSSQL check conflict',
      { number: 547, message: 'The INSERT statement conflicted with the CHECK constraint "CK_Item_price".' },
      'checkViolation',
    ],
    ['an MSSQL null column', { number: 515 }, 'notNullViolation'],
    ['an MSSQL deadlock', { number: 1205 }, 'retryable'],
    ['an MSSQL lock timeout', { number: 1222 }, 'retryable'],
    ['an MSSQL snapshot conflict', { number: 3960 }, 'retryable'],
    ['a MongoDB duplicate key', { code: 11000 }, 'uniqueViolation'],
    ['a MongoDB validation failure', { code: 121 }, 'checkViolation'],
    ['a MongoDB write conflict', { code: 112 }, 'retryable'],
    ['a MongoDB transient transaction error', { errorLabels: ['TransientTransactionError'] }, 'retryable'],
    ['a SQLite unique violation', { message: 'UNIQUE constraint failed: User.id' }, 'uniqueViolation'],
    ['a D1 unique violation', { message: 'D1_ERROR: UNIQUE constraint failed: User.id' }, 'uniqueViolation'],
    ['a SQLite foreign key violation', { message: 'FOREIGN KEY constraint failed' }, 'foreignKeyViolation'],
    ['a SQLite not-null violation', { message: 'NOT NULL constraint failed: User.name' }, 'notNullViolation'],
    ['a SQLite check violation', { message: 'CHECK constraint failed: price > 0' }, 'checkViolation'],
    ['a busy SQLite database', { message: 'SQLITE_BUSY: database is locked' }, 'retryable'],
  ])('names %s', (_, err, kind) => {
    expect(queryErrorKind(err)).toBe(kind);
  });

  it.each<[string, unknown]>([
    ['an unknown SQLSTATE', { code: '42P01' }],
    ['an unknown MySQL errno', { errno: 1146 }],
    ['a Node connection error', { code: 'ECONNREFUSED', errno: -111, message: 'connect ECONNREFUSED' }],
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
  ])('names nothing for %s', (_, err) => {
    expect(queryErrorKind(err)).toBeUndefined();
  });
});
