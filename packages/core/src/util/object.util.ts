export function clone<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((it) => clone(it)) as unknown as T;
  }
  if (isPrimitive(obj)) {
    return obj;
  }
  return { ...obj };
}

export function isPrimitive(val: any): boolean {
  return val !== Object(val);
}

export function hasKeys<T>(obj: T): boolean {
  return getKeys(obj)?.length > 0;
}

export function getKeys<T>(obj: T): string[] {
  return obj ? Object.keys(obj) : undefined;
}
