import { type CallHandler, type ExecutionContext, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { firstValueFrom, Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { getContext } from '../context/context.js';
import * as options from '../options.js';
import type { Querier, QuerierPool } from '../type/index.js';
import { UqlContextInterceptor } from './uqlContextInterceptor.js';
import { UQL_QUERIER_POOL, UqlModule } from './uqlModule.js';

vi.mock('../options.js');

describe('UqlModule', () => {
  const pool = {
    getQuerier: vi.fn().mockResolvedValue({} as Querier),
    end: vi.fn(),
  } as unknown as QuerierPool;

  it('provides the pool via the injection token and sets the default pool', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UqlModule.forRoot({ pool })],
    }).compile();

    expect(moduleRef.get<QuerierPool>(UQL_QUERIER_POOL)).toBe(pool);
    expect(options.setQuerierPool).toHaveBeenCalledWith(pool);
  });

  it('registers globally by default and honors global: false', () => {
    expect(UqlModule.forRoot({ pool }).global).toBe(true);
    expect(UqlModule.forRoot({ pool, global: false }).global).toBe(false);
  });

  it('ends the pool on application shutdown', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UqlModule.forRoot({ pool })],
    }).compile();

    expect(pool.end).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('registers the context interceptor only when getContext is provided', () => {
    const has = (mod: { providers?: unknown[] }) =>
      (mod.providers ?? []).some((p) => (p as { provide?: unknown }).provide === APP_INTERCEPTOR);
    expect(has(UqlModule.forRoot({ pool }))).toBe(false);
    expect(has(UqlModule.forRoot({ pool, getContext: () => ({}) }))).toBe(true);
  });

  it('forRootAsync builds the pool from a factory (with injected deps) and sets the default pool', async () => {
    const CONFIG = Symbol('CONFIG');
    @Module({ providers: [{ provide: CONFIG, useValue: { pool } }], exports: [CONFIG] })
    class ConfigTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        UqlModule.forRootAsync({
          imports: [ConfigTestModule],
          useFactory: (cfg: { pool: QuerierPool }) => cfg.pool,
          inject: [CONFIG],
        }),
      ],
    }).compile();

    expect(moduleRef.get<QuerierPool>(UQL_QUERIER_POOL)).toBe(pool);
    expect(options.setQuerierPool).toHaveBeenCalledWith(pool);
  });
});

describe('UqlContextInterceptor', () => {
  it('runs the handler inside withContext so getContext() resolves the request context', async () => {
    let seen: unknown;
    const interceptor = new UqlContextInterceptor<{ tid: number }>((req) => ({ tenantId: req.tid }));
    const execContext = {
      switchToHttp: () => ({ getRequest: () => ({ tid: 7 }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          seen = getContext();
          subscriber.next(undefined);
          subscriber.complete();
        }),
    };

    await firstValueFrom(interceptor.intercept(execContext, next));
    expect(seen).toEqual({ tenantId: 7 });
  });
});
