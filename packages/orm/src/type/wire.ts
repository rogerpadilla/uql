import type { QuerySql } from './querySql.js';

/**
 * Which side of the wire a querier sits on, which says what SQL its queries may carry: both answer alike.
 */
export type QuerierTransport = 'server' | 'client';

/**
 * The `sql` SQL a transport carries. A client's query and payload travel as JSON, which a `sql` fragment
 * is not: it would arrive as `{}`, so the client's types refuse one rather than let it leave.
 */
export type QuerierSql<W extends QuerierTransport> = { server: QuerySql; client: never }[W];
