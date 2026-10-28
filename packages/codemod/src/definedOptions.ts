/** The options a defined entity's first call keeps, each as it is written there. */
export const FIRST_CALL_OPTIONS = ['name', 'table', 'schema', 'abstract', 'extends', 'fields'] as const;

/** The sections a defined entity chains after its first call, in the order it chains them, `relations` last. */
export const CHAINED_OPTIONS = ['computed', 'indexes', 'checks', 'triggers', 'filters', 'hooks'] as const;

/** The options a class-form `defineEntity` took that a defined entity keeps as they are, and that incremental definers add to. */
export const KEPT_OPTIONS = ['indexes', 'checks', 'filters', 'triggers'] as const;
