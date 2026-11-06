import { describe, expect, it } from 'vitest';
import { UqlOptimisticLockError, UqlRequestError, UqlSecurityError, UqlUsageError } from '../util/uqlError.js';
import { type RequestFailure, toErrorResponse } from './errors.js';

const INTERNAL_ERROR: RequestFailure = { message: 'Internal Server Error', status: 500 };

describe('toErrorResponse', () => {
  /** A driver's message names tables and constraints, and Postgres echoes the value: none of it is the client's. */
  it('should answer an unknown failure with a generic 500, never its message', () => {
    expect(toErrorResponse(new Error('relation "secret_table" does not exist'))).toEqual({
      status: 500,
      body: { error: INTERNAL_ERROR },
    });
  });

  /** A client sees a message only where UQL raised it: an HTTP driver's own `status` comes with one naming tables. */
  it('should answer an error UQL did not raise as a 500, whatever status it carries', () => {
    const err = Object.assign(new Error('no such table: secret'), { status: 400 });
    expect(toErrorResponse(err)).toEqual({ status: 500, body: { error: INTERNAL_ERROR } });
  });

  it('should answer a request refusal with its status and message', () => {
    expect(toErrorResponse(new UqlRequestError('unauthorized', 401))).toEqual({
      status: 401,
      body: { error: { message: 'unauthorized', status: 401, kind: 'usage' } },
    });
  });

  it('should answer a security refusal with a 403 and its kind', () => {
    const message = "filter 'tenant' on 'Note' could not resolve (missing context)";
    expect(toErrorResponse(new UqlSecurityError(message))).toEqual({
      status: 403,
      body: { error: { message, status: 403, kind: 'security' } },
    });
  });

  it('should carry where in the call a refused value sits', () => {
    const err = new UqlUsageError("'$lock' is not a query key the wire takes", { path: ['query', '$lock'] });
    expect(toErrorResponse(err).body.error).toEqual({
      message: "'$lock' is not a query key the wire takes",
      status: 400,
      kind: 'usage',
      path: ['query', '$lock'],
    });
  });

  it('should carry no path for an error naming none', () => {
    const err = new UqlUsageError('carries no version', { cause: new Error('stale') });
    expect(toErrorResponse(err).body.error).toEqual({ message: 'carries no version', status: 400, kind: 'usage' });
  });

  it.each<[string, unknown, RequestFailure]>([
    [
      'a unique violation',
      Object.assign(new Error('Key (email)=(a@b.com) exists'), { code: '23505' }),
      { message: 'Conflict', status: 409, kind: 'uniqueViolation' },
    ],
    [
      'a foreign key violation',
      new Error('FOREIGN KEY constraint failed'),
      { message: 'Conflict', status: 409, kind: 'foreignKeyViolation' },
    ],
    [
      'a stale version',
      new UqlOptimisticLockError('moved on', 3, 4),
      { message: 'moved on', status: 409, kind: 'optimisticLock' },
    ],
    [
      'a $lock the engine lacks',
      new UqlUsageError('SQLite does not support row-level locking'),
      { message: 'SQLite does not support row-level locking', status: 400, kind: 'usage' },
    ],
    [
      'a not-null violation',
      Object.assign(new Error("Column 'name' cannot be null"), { errno: 1048 }),
      { message: 'Bad Request', status: 400, kind: 'notNullViolation' },
    ],
    [
      'a check violation',
      Object.assign(new Error('violates check constraint'), { code: '23514' }),
      { message: 'Bad Request', status: 400, kind: 'checkViolation' },
    ],
    [
      'a retryable failure',
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      { message: 'Service Unavailable', status: 503, kind: 'retryable' },
    ],
    [
      'a constraint kind, whatever status the driver set',
      Object.assign(new Error('taken'), { code: '23505', status: 422 }),
      { message: 'Conflict', status: 409, kind: 'uniqueViolation' },
    ],
    ['a value that is no error', 'raw string error', INTERNAL_ERROR],
  ])('should map %s', (_, err, error) => {
    expect(toErrorResponse(err)).toEqual({ status: error.status, body: { error } });
  });
});
