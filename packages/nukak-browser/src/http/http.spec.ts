import { post, patch, put, get, remove } from './http.js';

describe('http', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn().mockImplementation(setupFetchStub({}));
  });

  afterEach(() => {
    delete globalThis.fetch;
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

  it('error', async () => {
    globalThis.fetch = jest.fn().mockImplementation(setupFetchStubError(new Error('some error')));
    await expect(async () => {
      await remove('/?a=1');
    }).rejects.toThrow('some error');
  });
});

function setupFetchStub(data: object) {
  return async (_url: string) => ({
    status: 200,
    json: async () => ({ data }),
  });
}

function setupFetchStubError(error: Error) {
  return async (_url: string) => ({
    status: 500,
    json: async () => ({ error }),
  });
}
