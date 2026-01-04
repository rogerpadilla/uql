import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as options from '../options.js';
import { User } from '../test/index.js';
import type { Querier } from '../type/index.js';
import { errorHandler, querierMiddleware } from './querierMiddleware.js';

vi.mock('../options.js', async () => {
  const actual = await vi.importActual<any>('../options.js');
  return {
    ...actual,
    getQuerier: vi.fn(),
  };
});

describe('querierMiddleware', () => {
  let app: express.Express;
  let mockQuerier: Record<keyof Querier, Mock>;

  beforeEach(() => {
    mockQuerier = {
      findOne: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      insertOne: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
    } as unknown as Record<keyof Querier, Mock>;

    (options.getQuerier as Mock).mockResolvedValue(mockQuerier);

    app = express();
    app.use(express.json());
    app.set('query parser', 'extended');
    app.use('/api', querierMiddleware({ include: [User] }));

    app.use(errorHandler);
  });

  it('GET /api/user/one', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1, name: 'John' });
    const res = await request(app).get('/api/user/one?name=John');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 1, name: 'John' }, count: 1 });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ name: 'John' }));
  });

  it('GET /api/user/:id', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123, name: 'John' });
    const res = await request(app).get('/api/user/123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 123, name: 'John' }, count: 1 });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '123' } }));
  });

  it('GET /api/user', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'John' }]);
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 1, name: 'John' }] });
    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.any(Object));
  });

  it('GET /api/user with count', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'John' }]);
    mockQuerier.count.mockResolvedValue(1);
    const res = await request(app).get('/api/user?count=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 1, name: 'John' }], count: 1 });
  });

  it('GET /api/user/count', async () => {
    mockQuerier.count.mockResolvedValue(5);
    const res = await request(app).get('/api/user/count');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: 5, count: 5 });
  });

  it('POST /api/user', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const res = await request(app).post('/api/user').send({ name: 'John' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: 1, count: 1 });
    expect(mockQuerier.beginTransaction).toHaveBeenCalled();
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.commitTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('PATCH /api/user/:id', async () => {
    mockQuerier.updateMany.mockResolvedValue(1);
    const res = await request(app).patch('/api/user/1').send({ name: 'John' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: '1', count: 1 });
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      name: 'John',
    });
  });

  it('DELETE /api/user/:id', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const res = await request(app).delete('/api/user/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: '1', count: 1 });
  });

  it('DELETE /api/user', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockQuerier.deleteMany.mockResolvedValue(2);
    const res = await request(app).delete('/api/user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [1, 2], count: 2 });
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, { $where: [1, 2] }, expect.any(Object));
  });

  it('GET /api/user/one should handle error', async () => {
    mockQuerier.findOne.mockRejectedValue(new Error('One error'));
    const res = await request(app).get('/api/user/one');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('One error');
  });

  it('GET /api/user/count should handle error', async () => {
    mockQuerier.count.mockRejectedValue(new Error('Count error'));
    const res = await request(app).get('/api/user/count');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Count error');
  });

  it('GET /api/user/:id should handle error', async () => {
    mockQuerier.findOne.mockRejectedValue(new Error('ID error'));
    const res = await request(app).get('/api/user/123');
    expect(res.status).toBe(500);
  });

  it('GET /api/user should handle error', async () => {
    mockQuerier.findMany.mockRejectedValue(new Error('Many error'));
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(500);
  });

  it('POST /api/user should rollback on error', async () => {
    mockQuerier.insertOne.mockRejectedValue(new Error('Insert error'));
    const res = await request(app).post('/api/user').send({ name: 'John' });
    expect(res.status).toBe(500);
    expect(mockQuerier.rollbackTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('PATCH /api/user/:id should rollback on error', async () => {
    mockQuerier.updateMany.mockRejectedValue(new Error('Update error'));
    const res = await request(app).patch('/api/user/1').send({ name: 'John' });
    expect(res.status).toBe(500);
    expect(mockQuerier.rollbackTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('DELETE /api/user/:id should rollback on error', async () => {
    mockQuerier.deleteMany.mockRejectedValue(new Error('Delete error'));
    const res = await request(app).delete('/api/user/1');
    expect(res.status).toBe(500);
    expect(mockQuerier.rollbackTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('DELETE /api/user should rollback on error', async () => {
    mockQuerier.findMany.mockRejectedValue(new Error('Find error'));
    const res = await request(app).delete('/api/user');
    expect(res.status).toBe(500);
    expect(mockQuerier.rollbackTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should throw error if no entities provided', () => {
    expect(() => querierMiddleware({ include: [] })).toThrow('no entities for the uql express middleware');
  });

  it('GET /api/user/:id with $where as array', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const res = await request(app).get('/api/user/123?$where[]=1');
    expect(res.status).toBe(200);
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: ['1', '123'] }));
  });

  it('PATCH /api/user/:id with $where as array', async () => {
    mockQuerier.updateMany.mockResolvedValue(1);
    const res = await request(app).patch('/api/user/1?$where[]=2').send({ name: 'John' });
    expect(res.status).toBe(200);
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: ['2', '1'] }), {
      name: 'John',
    });
  });

  it('DELETE /api/user/:id with $where as array', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const res = await request(app).delete('/api/user/1?$where[]=3');
    expect(res.status).toBe(200);
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: ['3', '1'] }), {
      softDelete: false,
    });
  });

  it('querierMiddleware should respect exclude', async () => {
    class OtherEntity {}
    const router = querierMiddleware({ include: [User, OtherEntity], exclude: [OtherEntity] });
    app = express();
    app.use('/api', router);
    const res = await request(app).get('/api/other-entity');
    expect(res.status).toBe(404);
  });
});
