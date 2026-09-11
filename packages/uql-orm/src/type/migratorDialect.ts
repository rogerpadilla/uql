import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import type { MongoDialect } from '../mongo/mongoDialect.js';
import type { DialectName } from './querier.js';

/** The dialects the migrator runs on, which `dialectName` tells apart: every SQL engine, and MongoDB. */
export type MigratorDialect = AbstractSqlDialect | MongoDialect;

const KNOWN_MIGRATOR_DIALECTS = [
  'postgres',
  'cockroachdb',
  'mysql',
  'mariadb',
  'sqlite',
  'mssql',
  'mongodb',
] as const satisfies readonly DialectName[];

export type KnownMigratorDialect = (typeof KNOWN_MIGRATOR_DIALECTS)[number];

/**
 * Whether `d` is supported by built-in migrator introspection / schema generators.
 * Other `Dialect` values may still be valid on a pool but get no default generator.
 */
export function isKnownMigratorDialect(d: DialectName): d is KnownMigratorDialect {
  return KNOWN_MIGRATOR_DIALECTS.includes(d);
}
