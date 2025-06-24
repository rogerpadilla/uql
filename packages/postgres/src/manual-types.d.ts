declare module 'sqlstring-sqlite' {
  // biome-ignore lint/suspicious/noShadowRestrictedNames: exported by third-party
  export function escape(value: unknown): string;
}
