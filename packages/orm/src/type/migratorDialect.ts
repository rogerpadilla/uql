import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';

/**
 * The dialects the migrator runs on, which `dialectName` tells apart: every SQL engine, and MongoDB, named
 * by its `dialectName` alone so these types reach no `mongodb` declaration.
 */
export type MigratorDialect = AbstractSqlDialect | (AbstractDialect & { readonly dialectName: 'mongodb' });
