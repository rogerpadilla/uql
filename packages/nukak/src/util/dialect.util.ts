import { getKeys } from '../util/index.js';
import {
  EntityMeta,
  FieldKey,
  QuerySelect,
  CascadeType,
  RelationKey,
  FieldOptions,
  Key,
  QueryRaw,
  QuerySort,
  QuerySortMap,
  QueryRawFnOptions,
  QueryWhere,
  QueryWhereMap,
  OnFieldCallback,
  MongoId,
  IdValue,
} from '../type/index.js';

type CallbackKey = keyof Pick<FieldOptions, 'onInsert' | 'onUpdate' | 'onDelete'>;

export function getRawValue(opts: QueryRawFnOptions & { value: QueryRaw; autoPrefixAlias?: boolean }) {
  const { value, prefix = '', dialect, autoPrefixAlias } = opts;
  const val = typeof value.value === 'function' ? value.value(opts) : prefix + value.value;
  const alias = value.alias;
  if (alias) {
    const fullAlias = autoPrefixAlias ? prefix + alias : alias;
    const escapedFullAlias = dialect.escapeId(fullAlias, true);
    return `${val} ${escapedFullAlias}`;
  }
  return val;
}

export function getPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
  return getPersistables(meta, payload, callbackKey)[0];
}

export function getPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = fillOnFields(meta, payload, callbackKey);
  const persistableKeys = getKeys(payloads[0]).filter((key) => {
    const fieldOpts = meta.fields[key as FieldKey<E>];
    return fieldOpts && (callbackKey !== 'onUpdate' || (fieldOpts.updatable ?? true));
  }) as FieldKey<E>[];
  return payloads.map((it) =>
    persistableKeys.reduce((acc, key) => {
      acc[key] = it[key];
      return acc;
    }, {} as E),
  );
}

export function getFieldCallbackValue(val: OnFieldCallback) {
  return typeof val === 'function' ? val() : val;
}

function fillOnFields<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = getKeys(meta.fields).filter((key) => meta.fields[key][callbackKey]);
  return payloads.map((it) => {
    for (const key of keys) {
      if (it[key] === undefined) {
        it[key] = getFieldCallbackValue(meta.fields[key][callbackKey]);
      }
    }
    return it;
  });
}

export function getPersistableRelations<E>(meta: EntityMeta<E>, payload: E, action: CascadeType): RelationKey<E>[] {
  const keys = getKeys(payload);
  return keys.filter((key) => {
    const relOpts = meta.relations[key as RelationKey<E>];
    return relOpts && isCascadable(action, relOpts.cascade);
  }) as RelationKey<E>[];
}

export function isCascadable(action: CascadeType, configuration?: boolean | CascadeType): boolean {
  if (typeof configuration === 'boolean') {
    return configuration;
  }
  return configuration === action;
}

export function getSelectRelationKeys<E>(meta: EntityMeta<E>, select: QuerySelect<E>): RelationKey<E>[] {
  const keys = getPositiveKeys(select);
  return keys.filter((key) => key in meta.relations) as RelationKey<E>[];
}

export function isSelectingRelations<E>(meta: EntityMeta<E>, select: QuerySelect<E>): boolean {
  const keys = getPositiveKeys(select);
  return keys.some((key) => key in meta.relations);
}

function getPositiveKeys<E>(select: QuerySelect<E>): Key<E>[] {
  if (Array.isArray(select)) {
    return select as Key<E>[];
  }
  return getKeys(select).filter((key) => select[key]) as Key<E>[];
}

export function buildSortMap<E>(sort: QuerySort<E>): QuerySortMap<E> {
  if (Array.isArray(sort)) {
    return sort.reduce((acc, it) => {
      if (Array.isArray(it)) {
        acc[it[0]] = it[1];
      } else {
        acc[it.field] = it.sort;
      }
      return acc;
    }, {} as QuerySortMap<E>);
  }
  return sort as QuerySortMap<E>;
}

export function augmentWhere<E>(
  meta: EntityMeta<E>,
  target: QueryWhere<E> = {},
  source: QueryWhere<E> = {},
): QueryWhere<E> {
  const targetComparison = getQueryWhereAsMap(meta, target);
  const sourceComparison = getQueryWhereAsMap(meta, source);
  return {
    ...targetComparison,
    ...sourceComparison,
  };
}

export function getQueryWhereAsMap<E>(meta: EntityMeta<E>, filter: QueryWhere<E> = {}): QueryWhereMap<E> {
  if (filter instanceof QueryRaw) {
    return { $and: [filter] } as QueryWhereMap<E>;
  }
  if (isIdValue(filter)) {
    return {
      [meta.id]: filter,
    } as QueryWhereMap<E>;
  }
  return filter as QueryWhereMap<E>;
}

function isIdValue<E>(filter: QueryWhere<E>): filter is IdValue<E> | IdValue<E>[] {
  const type = typeof filter;
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'bigint' ||
    typeof (filter as MongoId).toHexString === 'function' ||
    Array.isArray(filter)
  );
}
