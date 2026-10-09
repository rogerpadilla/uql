/**
 * A text-search config as MongoDB names the language: the same word for each language both know, and
 * `'none'` for the no-stemming parser Postgres calls `'simple'`. {@link textConfigOf} reads one back.
 */
export function textLanguage(config: string): string {
  return config === 'simple' ? 'none' : config;
}

/** A MongoDB language as the text-search config it is, the inverse of {@link textLanguage}. */
export function textConfigOf(language: string): string {
  return language === 'none' ? 'simple' : language;
}
