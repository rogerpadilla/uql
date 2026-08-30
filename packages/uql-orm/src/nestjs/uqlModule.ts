import {
  type DynamicModule,
  type FactoryProvider,
  Module,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { QuerierPool, UqlContext } from '../type/index.js';
import { UqlContextInterceptor } from './uqlContextInterceptor.js';

/**
 * Injection token for the configured {@link QuerierPool} - for injecting into your own
 * providers. UQL's own machinery (`getQuerier`, `querierMiddleware`, `createFetchHandler`) reads
 * the default pool set by {@link UqlModule.forRoot}, not this token, so overriding the provider
 * does not redirect UQL internals.
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
 * Ends the pool when Nest shuts down.
 *
 * @remarks A provider rather than a hook on the module class, and built through `useFactory` with an
 * `inject` list rather than constructor injection: Nest injects constructor parameters with a parameter
 * decorator, and the TC39 decorator spec has none, so `@Inject()` cannot appear in a file compiled
 * against it. Nest runs lifecycle hooks on providers too, so this keeps the pool that *this* module was
 * configured with instead of reaching for the global default.
 */
class UqlPoolLifecycle implements OnApplicationShutdown {
  constructor(private readonly pool: QuerierPool) {}

  onApplicationShutdown(): Promise<void> {
    return this.pool.end();
  }
}

/**
 * NestJS integration: provides the pool via DI under {@link UQL_QUERIER_POOL}, optionally scopes
 * every request to a {@link UqlContext} (multi-tenancy), and ends the pool on application shutdown.
 * Inject the pool where you need it, `querierMiddleware`/`createFetchHandler` included: those take
 * it as an option rather than reading a process-wide default.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS needs a decorated class as the module token; the shutdown hook that once made this an instance now lives on its own provider.
export class UqlModule {
  /** Configure with an already-built pool. */
  static forRoot<Req = unknown>({ pool, global = true, getContext }: UqlModuleOptions<Req>): DynamicModule {
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
      useFactory,
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
    const providers: Provider[] = [
      poolProvider,
      {
        provide: UqlPoolLifecycle,
        useFactory: (pool: QuerierPool) => new UqlPoolLifecycle(pool),
        inject: [UQL_QUERIER_POOL],
      },
    ];
    if (getContext) {
      // Scope every request to its context so multi-tenancy / security filters apply automatically.
      providers.push({ provide: APP_INTERCEPTOR, useValue: new UqlContextInterceptor(getContext) });
    }
    return { module: UqlModule, global, imports, providers, exports: [UQL_QUERIER_POOL] };
  }
}
