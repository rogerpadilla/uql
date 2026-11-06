import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpTransport, RequestError } from './httpTransport.js';

/** A `fetch` answering `body` with `status`, recording what it was asked. */
function stubFetch(body: unknown, status = 200, statusText = 'OK') {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('httpTransport', () => {
  let fetch: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetch = stubFetch({ data: [{ id: 1 }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should GET a read, the call in q, answering its data', async () => {
    const send = httpTransport('/api/v1');

    expect(await send({ entity: 'user', op: 'findMany', query: { $limit: 1 } })).toEqual([{ id: 1 }]);
    expect(fetch).toHaveBeenCalledWith(`/api/v1/user/findMany?q=${encodeURIComponent('{"query":{"$limit":1}}')}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  });

  it('should GET a read carrying nothing with no q', async () => {
    await httpTransport('/api/v1')({ entity: 'user', op: 'count' });

    expect(fetch).toHaveBeenCalledWith('/api/v1/user/count', expect.objectContaining({ method: 'GET' }));
  });

  it.each(['QUERY', 'POST'] as const)('should send a read as %s, the call in the body', async (readMethod) => {
    await httpTransport('/api/v1', { readMethod })({ entity: 'user', op: 'findOneById', id: 1 });

    expect(fetch).toHaveBeenCalledWith('/api/v1/user/findOneById', {
      method: readMethod,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"id":1}',
    });
  });

  it('should POST a write, whatever reads take', async () => {
    await httpTransport('/api/v1')({ entity: 'user', op: 'updateOneById', id: 1, payload: { name: 'a' } });

    expect(fetch).toHaveBeenCalledWith('/api/v1/user/updateOneById', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"id":1,"payload":{"name":"a"}}',
    });
  });

  it('should merge per-call headers over the defaults, and pass the signal', async () => {
    const signal = new AbortController().signal;
    const send = httpTransport('/api', { headers: { authorization: 'a', 'x-tenant': '1' } });

    await send({ entity: 'user', op: 'count' }, { headers: { authorization: 'b' }, signal });

    expect(fetch).toHaveBeenCalledWith('/api/user/count', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'b', 'x-tenant': '1' },
      signal,
    });
  });

  /** `{ data: undefined }`, what a read finding nothing answers, is `{}` once JSON wrote it. */
  it('should answer undefined for an envelope holding no data', async () => {
    stubFetch({});

    expect(await httpTransport('/api')({ entity: 'user', op: 'findOne' })).toBeUndefined();
  });

  /** A wrong base URL lands on a page a SPA or a proxy answers with HTML, which is no answer of the API's. */
  it('should refuse a success that is no JSON envelope', async () => {
    stubFetch(undefined, 200, 'OK');

    const refused = await httpTransport('/api')({ entity: 'user', op: 'findOne' }).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(RequestError);
    expect(refused).toMatchObject({
      status: 200,
      message: "the response is no API answer: no JSON '{ data }' envelope",
    });
  });

  it('should throw the failure the API answered, with its status, kind and path', async () => {
    const error = { message: "'password' cannot be read", status: 403, kind: 'security', path: ['query', 'password'] };
    stubFetch({ error }, 403, 'Forbidden');

    const refused = await httpTransport('/api')({ entity: 'user', op: 'findMany' }).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(RequestError);
    expect(refused).toMatchObject(error);
  });

  it('should throw the response status where the body is no JSON', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => Promise.reject(new SyntaxError('Unexpected token <')),
    }));
    vi.stubGlobal('fetch', fetch);

    const refused = await httpTransport('/api')({ entity: 'user', op: 'findMany' }).catch((err: unknown) => err);

    expect(refused).toMatchObject({ message: 'Bad Gateway', status: 502 });
  });

  it('should throw the response status where the body names no failure, or a malformed one', async () => {
    stubFetch({ error: { kind: 'unknown', path: [{}] } }, 502, 'Bad Gateway');

    const refused = await httpTransport('/api')({ entity: 'user', op: 'findMany' }).catch((err: unknown) => err);

    expect(refused).toMatchObject({ message: 'Bad Gateway', status: 502 });
    expect(refused).not.toHaveProperty('kind');
    expect(refused).not.toHaveProperty('path');
  });
});
