import type { HranaClient } from '../sqlite/hranaQuerier.js';
import { AbstractHranaQuerierPool } from '../sqlite/hranaQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { TursoDialect } from './tursoDialect.js';
import { TursoQuerier } from './tursoQuerier.js';

/**
 * Connection settings for Turso Cloud, mirroring `@tursodatabase/serverless`.
 *
 * @remarks Declared here rather than imported so this package does not couple its published types
 * to a pre-1.0 dependency.
 */
export type TursoConfig = {
  /** `libsql://<db>.turso.io` or `https://<db>.turso.io`. */
  url: string;
  authToken?: string;
  remoteEncryptionKey?: string;
  /** Extra HTTP headers attached to every request, e.g. for routing through a gateway. */
  requestHeaders?: Record<string, string>;
};

function isClient(conf: TursoConfig | HranaClient): conf is HranaClient {
  return typeof (conf as HranaClient).execute === 'function';
}

/**
 * Pool for remote Turso Cloud databases, driven by `@tursodatabase/serverless/compat`.
 *
 * @remarks The compat entry point is required rather than the native one: the native
 * `conn.transaction()` takes a callback, which cannot satisfy the explicit
 * `beginTransaction`/`commitTransaction` contract, and issuing a bare `BEGIN` is not an option
 * because over plain HTTP consecutive requests need not share a connection. Compat's session-backed
 * transaction handle is the piece that makes it work.
 */
export class TursoQuerierPool extends AbstractHranaQuerierPool<TursoQuerier, TursoDialect> {
  protected override readonly ownsClient: boolean;
  private readonly conf: TursoConfig | HranaClient;

  /**
   * Accepts either connection settings or an already-built client. The latter covers any driver
   * with the same shape: `@libsql/client/web`, `@libsql/client-wasm`, or a test double.
   */
  constructor(conf: TursoConfig | HranaClient, extra?: ExtraOptions) {
    super(new TursoDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.conf = conf;
    this.ownsClient = !isClient(conf);
  }

  protected override async openClient(): Promise<HranaClient> {
    if (isClient(this.conf)) {
      return this.conf;
    }
    const { createClient } = await import('@tursodatabase/serverless/compat');
    return createClient(this.conf);
  }

  protected override buildQuerier(client: HranaClient) {
    return new TursoQuerier(client, this.dialect, this.extra);
  }
}
