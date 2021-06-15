import { EntityMeta, PropertyOptions, Type } from '@uql/core/type';
import { getKeys } from '@uql/core/util';

type CallbackKey = keyof Pick<PropertyOptions, 'onInsert' | 'onUpdate'>;

export function filterPersistableKeys<E>(meta: EntityMeta<E>, payload: E): string[] {
  return getKeys(payload).filter((prop) => meta.properties[prop] && payload[prop] !== undefined);
}

export function buildPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
  return buildPersistables(meta, payload, callbackKey)[0];
}

export function buildPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = fillOnCallbacks(meta, payload, callbackKey);
  const persistableKeys = filterPersistableKeys(meta, payloads[0]);
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

export function getIndependentRelations<E>(meta: EntityMeta<E>, payload?: E): string[] {
  const keys = payload ? getKeys(payload) : getKeys(meta.relations);
  return keys.filter((key) => {
    const relOpts = meta.relations[key];
    return (
      relOpts &&
      ((relOpts.cardinality === '11' && relOpts.mappedBy) ||
        relOpts.cardinality === '1m' ||
        relOpts.cardinality === 'mm')
    );
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
