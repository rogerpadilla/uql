/**
 * Type-level regression test: a Postgres-wire driver changes how a parameter binds, never what the engine
 * has, and no other dialect takes a driver's capabilities at all.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, left out of the build.
 */
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';

export const wireDriver = new PostgresDialect({ driverCapabilities: { nativeArrays: false, explicitJsonCast: true } });

// @ts-expect-error an engine feature is the dialect's to state, not the driver's
export const engineFeature = new PostgresDialect({ driverCapabilities: { schemas: false } });

// @ts-expect-error only a Postgres-wire dialect reads how its driver binds
export const otherEngine = new MySqlDialect({ driverCapabilities: { nativeArrays: false } });
