import { HranaQuerier } from '../sqlite/hranaQuerier.js';

/**
 * Querier for remote Turso Cloud databases over `@tursodatabase/serverless/compat`.
 *
 * @remarks Empty subclass by design: that compat client speaks the Hrana protocol, so the whole
 * implementation is inherited. Kept as a distinct type so `TursoQuerierPool` does not expose a
 * libsql-named class.
 */
export class TursoQuerier extends HranaQuerier {}
