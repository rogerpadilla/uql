import { cloneDeep } from 'lodash';

export function clone<T>(obj: T): T {
  return cloneDeep(obj);
}

export function hasKeys<T>(obj: T): boolean {
  return objectKeys(obj)?.length > 0;
}

export function objectKeys<T>(obj: T): string[] {
  return obj ? Object.keys(obj) : undefined;
}
