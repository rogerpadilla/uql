import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import type { MongoDialect } from '../mongo/mongoDialect.js';

/** The dialects the migrator runs on, which `dialectName` tells apart: every SQL engine, and MongoDB. */
export type MigratorDialect = AbstractSqlDialect | MongoDialect;
