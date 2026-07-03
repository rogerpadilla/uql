import { type DynamicModule, Module } from '@nestjs/common';
import { setQuerierPool } from '../options.js';
import type { QuerierPool } from '../type/index.js';

/**
 * Injection token for the configured {@link QuerierPool} — for injecting into your own
 * providers. UQL's own machinery (`getQuerier`, `querierMiddleware`, `createFetchHandler`,
 * `@Transactional`) reads the default pool set by {@link UqlModule.forRoot}, not this token,
 * so overriding the provider does not redirect UQL internals.
 */
export const UQL_QUERIER_POOL = Symbol('UQL_QUERIER_POOL');

export type UqlModuleOptions = {
  readonly pool: QuerierPool;
  /**
   * register the module globally so the pool is injectable everywhere. Defaults to true.
   */
  readonly global?: boolean;
};

/**
 * Minimal NestJS integration: provides the pool via DI and sets it as the default pool,
 * so `getQuerier()`, `querierMiddleware` (express platform), `createFetchHandler`,
 * and the `@Transactional` decorator work unchanged.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic modules are classes by contract
export class UqlModule {
  static forRoot({ pool, global = true }: UqlModuleOptions): DynamicModule {
    setQuerierPool(pool);
    return {
      module: UqlModule,
      global,
      providers: [{ provide: UQL_QUERIER_POOL, useValue: pool }],
      exports: [UQL_QUERIER_POOL],
    };
  }
}
