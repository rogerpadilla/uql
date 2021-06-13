export function clone<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((it) => clone(it)) as unknown as T;
  }
  return { ...obj };
}

export function hasKeys<T>(obj: T): boolean {
  return getKeys(obj)?.length > 0;
}

export function getKeys<T>(obj: T): string[] {
  return obj ? Object.keys(obj) : undefined;
}
