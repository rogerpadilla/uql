import { EntityMeta, FieldKey, FieldOptions, RelationKey, Type } from '@uql/core/type';
import { getKeys } from '@uql/core/util';

type CallbackKey = keyof Pick<FieldOptions, 'onInsert' | 'onUpdate'>;

export function filterFields<E>(meta: EntityMeta<E>, payload: E): FieldKey<E>[] {
  return getKeys(payload).filter((key) => meta.fields[key] && payload[key] !== undefined) as FieldKey<E>[];
}

export function filterRelations<E>(meta: EntityMeta<E>, payload: E): RelationKey<E>[] {
  return getKeys(payload).filter((key) => meta.relations[key] && payload[key] !== undefined) as RelationKey<E>[];
}

export function buildPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
  return buildPersistables(meta, payload, callbackKey)[0];
}

export function buildPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = fillOnCallbacks(meta, payload, callbackKey);
  const persistableKeys = filterFields(meta, payloads[0]);
  return payloads.map((it) =>
    persistableKeys.reduce((acc, key) => {
      acc[key] = it[key];
      return acc;
    }, {} as E)
  );
}

export function fillOnCallbacks<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = getKeys(meta.fields).filter((col) => meta.fields[col][callbackKey]);

  return payloads.map((it) => {
    for (const key of keys) {
      if (it[key] === undefined) {
        it[key] = meta.fields[key][callbackKey]();
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
