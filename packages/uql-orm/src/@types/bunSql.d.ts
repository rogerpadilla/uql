/** biome-ignore-all lint/style/noNamespace: augmenting Bun's own `SQL` namespace */
declare module 'bun' {
  namespace SQL {
    /**
     * Options the Bun runtime accepts that `@types/bun` has not caught up with.
     *
     * `allowPublicKeyRetrieval` is Bun 1.4's: MySQL 9 authenticates with `caching_sha2_password`,
     * whose first handshake for a user needs the server's RSA key, and 1.4 refuses to fetch one over
     * a plaintext socket unless asked. Declared here rather than cast at the call site, and to be
     * deleted once `@types/bun` ships a 1.4 line.
     */
    interface PostgresOrMySQLOptions {
      allowPublicKeyRetrieval?: boolean;
    }
  }
}

export {};
