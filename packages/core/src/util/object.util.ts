export function cloneDeep<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload));
}
