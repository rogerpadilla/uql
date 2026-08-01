import { HranaQuerier } from '../sqlite/hranaQuerier.js';

/**
 * Querier for the `@libsql/client` driver.
 *
 * @remarks Empty subclass by design: that client speaks the Hrana protocol, so the whole
 * implementation is inherited. Kept as a distinct type for `LibsqlQuerierPool` and as a hook for
 * future libsql-specific behavior.
 */
export class LibsqlQuerier extends HranaQuerier {}
