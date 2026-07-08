import {
  type DynamicModule,
  type FactoryProvider,
  Inject,
  Module,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { setQuerierPool } from '../options.js';
import type { QuerierPool, UqlContext } from '../type/index.js';
import { UqlContextInterceptor } from './uqlContextInterceptor.js';

/**
 * Injection token for the configured {@link QuerierPool} - for injecting into your own
 * providers. UQL's own machinery (`getQuerier`, `querierMiddleware`, `createFetchHandler`,
 * `@Transactional`) reads the default pool set by {@link UqlModule.forRoot}, not this token,
 * so overriding the provider does not redirect UQL internals.
 */
export const UQL_QUERIER_POOL = Symbol('UQL_QUERIER_POOL');

/** Shared by {@link UqlModuleOptions} and {@link UqlModuleAsyncOptions}. */
type UqlModuleCommon<Req> = {
  /** register the module globally so the pool is injectable everywhere. Defaults to true. */
  readonly global?: boolean;
  /**
   * Derive the ambient {@link UqlContext} (e.g. `{ tenantId, userId }`) from each HTTP request.
   * When set, a global interceptor runs every request inside `withContext`, so parameterized /
   * `security` filters (multi-tenancy, RLS) are scoped automatically. Derive tenant/auth from a
   * verified source (session, JWT) - never trust the client.
   */
  readonly getContext?: (request: Req) => UqlContext | undefined;
};

export type UqlModuleOptions<Req = unknown> = UqlModuleCommon<Req> & {
  readonly pool: QuerierPool;
};

export type UqlModuleAsyncOptions<Req = unknown> = UqlModuleCommon<Req> & {
  /** Modules to import so `inject` dependencies (e.g. `ConfigModule`) are resolvable. */
  readonly imports?: DynamicModule['imports'];
  /** Build the pool, optionally from injected providers (e.g. `ConfigService`). */
  readonly useFactory: FactoryProvider<QuerierPool>['useFactory'];
  /** Providers to inject into `useFactory`. */
  readonly inject?: FactoryProvider['inject'];
};

/**
 * NestJS integration: provides the pool via DI, sets it as UQL's default pool (so `getQuerier()`,
 * `querierMiddleware` (express platform), `createFetchHandler`, and `@Transactional` work unchanged),
 * optionally scopes every request to a {@link UqlContext} (multi-tenancy), and ends the pool on
 * application shutdown.
 */
@Module({})
export class UqlModule implements OnApplicationShutdown {
  constructor(@Inject(UQL_QUERIER_POOL) private readonly pool: QuerierPool) {}

  onApplicationShutdown(): Promise<void> {
    return this.pool.end();
  }

  /** Configure with an already-built pool. */
  static forRoot<Req = unknown>({ pool, global = true, getContext }: UqlModuleOptions<Req>): DynamicModule {
    setQuerierPool(pool);
    return UqlModule.build(global, { provide: UQL_QUERIER_POOL, useValue: pool }, getContext);
  }

  /** Configure with a pool built asynchronously from injected providers (e.g. `ConfigService`). */
  static forRootAsync<Req = unknown>({
    imports,
    useFactory,
    inject = [],
    global = true,
    getContext,
  }: UqlModuleAsyncOptions<Req>): DynamicModule {
    const poolProvider: FactoryProvider<QuerierPool> = {
      provide: UQL_QUERIER_POOL,
      useFactory: async (...args) => {
        const pool = await useFactory(...args);
        setQuerierPool(pool); // register as UQL's default once the pool is resolved
        return pool;
      },
      inject,
    };
    return UqlModule.build(global, poolProvider, getContext, imports);
  }

  private static build<Req>(
    global: boolean,
    poolProvider: Provider,
    getContext?: (request: Req) => UqlContext | undefined,
    imports?: DynamicModule['imports'],
  ): DynamicModule {
    const providers: Provider[] = [poolProvider];
    if (getContext) {
      // Scope every request to its context so multi-tenancy / security filters apply automatically.
      providers.push({ provide: APP_INTERCEPTOR, useValue: new UqlContextInterceptor(getContext) });
    }
    return { module: UqlModule, global, imports, providers, exports: [UQL_QUERIER_POOL] };
  }
}
