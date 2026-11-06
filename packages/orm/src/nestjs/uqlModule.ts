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

/** Injection token for the configured {@link QuerierPool}: for your own providers, and the `pool` of a `createApi`. */
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
  readonly contextOf?: (request: Req) => UqlContext | undefined | Promise<UqlContext | undefined>;
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
 * Ends the pool this module was configured with when Nest shuts down: a provider built by `useFactory`,
 * since TC39 decorators have no parameter decorator for `@Inject()`.
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
 * Inject the pool where you need it, a `createApi` included, which takes it as an option.
 */
// NestJS needs a decorated class as the module token; the shutdown hook lives on its own provider.
@Module({})
export class UqlModule {
  /** Configure with an already-built pool. */
  static forRoot<Req = unknown>({ pool, global = true, contextOf }: UqlModuleOptions<Req>): DynamicModule {
    return UqlModule.build(global, { provide: UQL_QUERIER_POOL, useValue: pool }, contextOf);
  }

  /** Configure with a pool built asynchronously from injected providers (e.g. `ConfigService`). */
  static forRootAsync<Req = unknown>({
    imports,
    useFactory,
    inject = [],
    global = true,
    contextOf,
  }: UqlModuleAsyncOptions<Req>): DynamicModule {
    const poolProvider: FactoryProvider<QuerierPool> = {
      provide: UQL_QUERIER_POOL,
      useFactory,
      inject,
    };
    return UqlModule.build(global, poolProvider, contextOf, imports);
  }

  private static build<Req>(
    global: boolean,
    poolProvider: Provider,
    contextOf?: UqlModuleCommon<Req>['contextOf'],
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
    if (contextOf) {
      // Scope every request to its context so multi-tenancy / security filters apply automatically.
      providers.push({ provide: APP_INTERCEPTOR, useValue: new UqlContextInterceptor(contextOf) });
    }
    return { module: UqlModule, global, imports, providers, exports: [UQL_QUERIER_POOL] };
  }
}
