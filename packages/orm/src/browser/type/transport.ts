import type { WireCall } from '../../http/wireCall.js';

/** What a call hands its transport beside the call itself. */
export type CallOptions = {
  /** Extra headers merged over the transport's defaults (e.g. `{ Authorization: 'Bearer ...' }`). */
  readonly headers?: Record<string, string>;
  /** Abort and timeout control, e.g. `AbortSignal.timeout(120_000)` for a long-running call. */
  readonly signal?: AbortSignal;
};

/**
 * Carries a call to an API and resolves to its result as the API answered it, as JSON carries it or already typed:
 * HTTP (`httpTransport`), a tRPC or oRPC procedure, a server action. Rejects on a failure.
 */
export type ClientTransport = (call: WireCall, opts?: CallOptions) => Promise<unknown>;
