import type { DialectName } from './querier.js';

const KNOWN_MIGRATOR_DIALECTS = [
  'postgres',
  'cockroachdb',
  'mysql',
  'mariadb',
  'sqlite',
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
