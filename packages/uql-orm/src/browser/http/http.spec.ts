import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, patch, post, put, query, RequestError, remove } from './http.js';

describe('http', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation(setupFetchStub({})) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('post', async () => {
    const body = {};
    await post('/', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ body: JSON.stringify(body), method: 'post' }),
    );
  });

  it('patch', async () => {
    const body = {};
    await patch('/', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ body: JSON.stringify(body), method: 'patch' }),
    );
  });

  it('put', async () => {
    const body = {};
    await put('/', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ body: JSON.stringify(body), method: 'put' }),
    );
  });

  it('get', async () => {
    await get('/?a=1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/?a=1', expect.objectContaining({ method: 'get' }));
  });

  it('remove', async () => {
    await remove('/?a=1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/?a=1', expect.objectContaining({ method: 'delete' }));
  });

  it('query sends the uppercase QUERY method with a JSON body', async () => {
    const payload = { $where: { name: 'a' } };
    await query('/user', payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/user',
      expect.objectContaining({ method: 'QUERY', body: JSON.stringify(payload) }),
    );
  });

  it('sends json headers by default', async () => {
    await get('/');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      }),
    );
  });

  it('merges custom headers over the defaults', async () => {
    await get('/', { headers: { authorization: 'Bearer abc', accept: 'text/plain' } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        headers: {
          accept: 'text/plain',
          'content-type': 'application/json',
          authorization: 'Bearer abc',
        },
      }),
    );
  });

  it('rejects with a RequestError carrying the HTTP status', async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        setupFetchStubError({ error: { message: 'payment required', code: 402 } }, 402),
      ) as unknown as typeof fetch;
    const failure = remove('/?a=1');
    await expect(failure).rejects.toBeInstanceOf(RequestError);
    await expect(failure).rejects.toMatchObject({ message: 'payment required', status: 402 });
  });

  it('passes an abort signal through to fetch', async () => {
    const signal = AbortSignal.timeout(120_000);
    await get('/', { signal });
    expect(globalThis.fetch).toHaveBeenCalledWith('/', expect.objectContaining({ signal }));
  });

  it('falls back to statusText when the error body is not the canonical envelope', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(get('/')).rejects.toThrow('Bad Gateway');
  });
});

function setupFetchStub(data: object) {
  return async (_url: string) => ({
    status: 200,
    json: async () => ({ data }),
  });
}

function setupFetchStubError(errorBody: object, status = 500) {
  return async (_url: string) => ({
    status,
    statusText: 'Internal Server Error',
    json: async () => errorBody,
  });
}
