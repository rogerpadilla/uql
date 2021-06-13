import { EntityMeta } from '@uql/core/type';
import { getKeys } from '@uql/core/util';

export function filterPersistableKeys<E>(meta: EntityMeta<E>, payload: E): string[] {
  return getKeys(payload).filter((prop) => meta.properties[prop] && payload[prop] !== undefined);
}

export function buildPersistablePayload<E>(meta: EntityMeta<E>, payload: E): E {
  const persistableProperties = filterPersistableKeys(meta, payload);
  return persistableProperties.reduce((acc, key) => {
    acc[key] = payload[key];
    return acc;
  }, {} as E);
}

export function buildPersistablePayloads<E>(meta: EntityMeta<E>, payloads: E[]): E[] {
  const persistableProperties = filterPersistableKeys(meta, payloads[0]);
  return payloads.map((it) =>
    persistableProperties.reduce((acc, key) => {
      acc[key] = it[key];
      return acc;
    }, {} as E)
  );
}
