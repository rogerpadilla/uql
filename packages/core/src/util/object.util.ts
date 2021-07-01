export function clone<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((it) => clone(it)) as unknown as T;
  }
  return { ...value };
}

export function hasKeys<T>(obj: T): boolean {
  return getKeys(obj).length > 0;
}

export function getKeys<T>(obj: T): string[] {
  return obj ? Object.keys(obj) : [];
}
