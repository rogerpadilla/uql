export function cloneDeep<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload));
}

export function hasKeys<T>(obj: T): boolean {
  return objectKeys(obj)?.length > 0;
}

export function objectKeys<T>(obj: T): string[] {
  return obj ? Object.keys(obj) : undefined;
}
