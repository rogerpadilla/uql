declare module 'sqlstring-sqlite' {
  // biome-ignore lint/suspicious/noShadowRestrictedNames: this is the sqlstring-sqlite module
  export function escape(value: unknown): string;
}
