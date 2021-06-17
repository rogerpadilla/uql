import { EntityMeta, Properties, PropertyOptions, Relations, Type } from '@uql/core/type';
import { getKeys } from '@uql/core/util';

type CallbackKey = keyof Pick<PropertyOptions, 'onInsert' | 'onUpdate'>;

export function filterProperties<E>(meta: EntityMeta<E>, payload: E): Properties<E>[] {
  return getKeys(payload).filter((key) => meta.properties[key] && payload[key] !== undefined) as Properties<E>[];
}

export function filterRelations<E>(meta: EntityMeta<E>, payload: E): Relations<E>[] {
  return getKeys(payload).filter((key) => meta.relations[key] && payload[key] !== undefined) as Relations<E>[];
}

export function buildPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
  return buildPersistables(meta, payload, callbackKey)[0];
}

export function buildPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = fillOnCallbacks(meta, payload, callbackKey);
  const persistableKeys = filterProperties(meta, payloads[0]);
  return payloads.map((it) =>
    persistableKeys.reduce((acc, key) => {
      acc[key] = it[key];
      return acc;
    }, {} as E)
  );
}

export function fillOnCallbacks<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = getKeys(meta.properties).filter((col) => meta.properties[col][callbackKey]);

  return payloads.map((it) => {
    for (const key of keys) {
      if (it[key] === undefined) {
        it[key] = meta.properties[key][callbackKey]();
      }
    }
    return it;
  });
}

export function isValidEntityType(type: any): type is Type<any> {
  return (
    typeof type === 'function' &&
    type !== Boolean &&
    type !== String &&
    type !== Number &&
    type !== BigInt &&
    type !== Date &&
    type !== Symbol &&
    type !== Object
  );
}
