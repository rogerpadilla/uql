import { type CallHandler, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { Test } from '@nestjs/testing';
import { firstValueFrom, Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { getContext } from '../context/context.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { UqlContextInterceptor } from './uqlContextInterceptor.js';
import { UQL_QUERIER_POOL, UqlModule } from './uqlModule.js';

describe('UqlModule', () => {
  const pool = createMockQuerierPool(new PostgresDialect(), async () => createMockQuerier());
  vi.spyOn(pool, 'end');

  it('should provide the pool via the injection token and set the default pool', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UqlModule.forRoot({ pool })],
    }).compile();

    expect(moduleRef.get<QuerierPool>(UQL_QUERIER_POOL)).toBe(pool);
  });

  it('should register globally by default and honor global: false', () => {
    expect(UqlModule.forRoot({ pool }).global).toBe(true);
    expect(UqlModule.forRoot({ pool, global: false }).global).toBe(false);
  });

  it('should end the pool on application shutdown', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UqlModule.forRoot({ pool })],
    }).compile();

    expect(pool.end).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('should register the context interceptor only when getContext is provided', () => {
    const has = (mod: { providers?: unknown[] }) =>
      (mod.providers ?? []).some((p) => (p as { provide?: unknown }).provide === APP_INTERCEPTOR);
    expect(has(UqlModule.forRoot({ pool }))).toBe(false);
    expect(has(UqlModule.forRoot({ pool, getContext: () => ({}) }))).toBe(true);
  });

  it('should build the pool from a factory with injected dependencies, and set the default pool', async () => {
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
  });
});

describe('UqlContextInterceptor', () => {
  it('should run the handler inside withContext so getContext() resolves the request context', async () => {
    let seen: unknown;
    const interceptor = new UqlContextInterceptor<{ tid: number }>((req) => ({ tenantId: req.tid }));
    const execContext = new ExecutionContextHost([{ tid: 7 }]);
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

  it('should run the handler in an empty context where the request resolves none', async () => {
    let seen: unknown;
    const interceptor = new UqlContextInterceptor(() => undefined);
    const execContext = new ExecutionContextHost([{}]);
    const next: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          seen = getContext();
          subscriber.next(undefined);
          subscriber.complete();
        }),
    };

    await firstValueFrom(interceptor.intercept(execContext, next));
    expect(seen).toEqual({});
  });
});
