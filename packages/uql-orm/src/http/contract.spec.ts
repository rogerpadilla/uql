import { describe, expect, it } from 'vitest';
import { User } from '../test/index.js';
import { entityPath, matchRoute, toErrorResponse } from './contract.js';

describe('entityPath', () => {
  it('kebab-cases the entity name', () => {
    expect(entityPath(User)).toBe('user');
    class UserProfile {}
    expect(entityPath(UserProfile)).toBe('user-profile');
  });
});

describe('matchRoute', () => {
  it('matches root routes by method', () => {
    expect(matchRoute('GET', undefined)).toEqual({ op: 'findMany', method: 'GET' });
    expect(matchRoute('POST', undefined)).toEqual({ op: 'insertOne', method: 'POST' });
    expect(matchRoute('PUT', undefined)).toEqual({ op: 'saveOne', method: 'PUT' });
    expect(matchRoute('PATCH', undefined)).toEqual({ op: 'updateMany', method: 'PATCH' });
    expect(matchRoute('DELETE', undefined)).toEqual({ op: 'deleteMany', method: 'DELETE' });
  });

  it('matches literal sub-paths', () => {
    expect(matchRoute('GET', 'one')).toEqual({ op: 'findOne', method: 'GET' });
    expect(matchRoute('GET', 'count')).toEqual({ op: 'count', method: 'GET' });
    expect(matchRoute('POST', 'many')).toEqual({ op: 'insertMany', method: 'POST' });
    expect(matchRoute('PUT', 'many')).toEqual({ op: 'saveMany', method: 'PUT' });
  });

  it('falls back to :id routes for non-literal sub-paths', () => {
    expect(matchRoute('GET', '123')).toEqual({ op: 'findOneById', method: 'GET', id: '123' });
    expect(matchRoute('PATCH', '123')).toEqual({ op: 'updateOneById', method: 'PATCH', id: '123' });
    expect(matchRoute('DELETE', '123')).toEqual({ op: 'deleteOneById', method: 'DELETE', id: '123' });
  });

  it('maps QUERY (RFC 10008) to the read operations only', () => {
    expect(matchRoute('QUERY', undefined)).toEqual({ op: 'findMany', method: 'QUERY' });
    expect(matchRoute('QUERY', 'one')).toEqual({ op: 'findOne', method: 'QUERY' });
    expect(matchRoute('QUERY', 'count')).toEqual({ op: 'count', method: 'QUERY' });
    expect(matchRoute('QUERY', 'many')).toBeUndefined();
    expect(matchRoute('QUERY', '123')).toBeUndefined();
  });

  it('is case-insensitive on the method', () => {
    expect(matchRoute('get', 'one')).toEqual({ op: 'findOne', method: 'GET' });
    expect(matchRoute('delete', undefined)).toEqual({ op: 'deleteMany', method: 'DELETE' });
  });

  it('serves HEAD as GET per HTTP semantics', () => {
    expect(matchRoute('HEAD', undefined)).toEqual({ op: 'findMany', method: 'GET' });
    expect(matchRoute('HEAD', 'count')).toEqual({ op: 'count', method: 'GET' });
    expect(matchRoute('HEAD', '123')).toEqual({ op: 'findOneById', method: 'GET', id: '123' });
  });

  it('returns undefined for unknown combinations', () => {
    expect(matchRoute('OPTIONS', undefined)).toBeUndefined();
    expect(matchRoute('POST', 'one')).toBeUndefined();
  });
});

describe('toErrorResponse', () => {
  it('maps a plain Error to a 500 envelope', () => {
    expect(toErrorResponse(new Error('boom'))).toEqual({
      status: 500,
      body: { error: { message: 'boom', code: 500 } },
    });
  });

  it('honors a numeric status on the error', () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    expect(toErrorResponse(err)).toEqual({
      status: 403,
      body: { error: { message: 'forbidden', code: 403 } },
    });
  });

  it('ignores a non-numeric status', () => {
    const err = Object.assign(new Error('odd'), { status: 'nope' });
    expect(toErrorResponse(err)).toEqual({
      status: 500,
      body: { error: { message: 'odd', code: 500 } },
    });
  });

  it('maps non-Error values to a generic 500', () => {
    expect(toErrorResponse('raw string error')).toEqual({
      status: 500,
      body: { error: { message: 'Internal Server Error', code: 500 } },
    });
  });
});
