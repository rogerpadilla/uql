import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, patch, post, put, query, RequestError, remove } from './http.js';

describe('http', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(setupFetchStub({})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send a POST with the JSON body', async () => {
    const body = {};
    await post('/', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ body: JSON.stringify(body), method: 'post' }),
    );
  });

  it('should send a PATCH with the JSON body', async () => {
    const body = {};
    await patch('/', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ body: JSON.stringify(body), method: 'patch' }),
    );
  });

  it('should send a PUT with the JSON body', async () => {
    const body = {};
    await put('/', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ body: JSON.stringify(body), method: 'put' }),
    );
  });

  it('should send a GET', async () => {
    await get('/?a=1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/?a=1', expect.objectContaining({ method: 'get' }));
  });

  it('should send a DELETE', async () => {
    await remove('/?a=1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/?a=1', expect.objectContaining({ method: 'delete' }));
  });

  it('should send the uppercase QUERY method with a JSON body', async () => {
    const payload = { $where: { name: 'a' } };
    await query('/user', payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/user',
      expect.objectContaining({ method: 'QUERY', body: JSON.stringify(payload) }),
    );
  });

  it('should send json headers by default', async () => {
    await get('/');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      }),
    );
  });

  it('should merge custom headers over the defaults', async () => {
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

  it('should reject with a RequestError carrying the HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(setupFetchStubError({ error: { message: 'payment required', code: 402 } }, 402)),
    );
    const failure = remove('/?a=1');
    await expect(failure).rejects.toBeInstanceOf(RequestError);
    await expect(failure).rejects.toMatchObject({ message: 'payment required', status: 402 });
  });

  it('should pass an abort signal through to fetch', async () => {
    const signal = AbortSignal.timeout(120_000);
    await get('/', { signal });
    expect(globalThis.fetch).toHaveBeenCalledWith('/', expect.objectContaining({ signal }));
  });

  it('should fall back to statusText when the error body is not the canonical envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({ status: 502, statusText: 'Bad Gateway', json: async () => ({}) })),
    );
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
