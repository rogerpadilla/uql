import { getKeys } from '../util/index.js';
import {
  EntityMeta,
  FieldKey,
  QueryProject,
  CascadeType,
  RelationKey,
  FieldOptions,
  Key,
  QueryRaw,
  QuerySort,
  QuerySortMap,
  QueryRawFnOptions,
  QueryFilter,
  QueryFilterMap,
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
  const persistableKeys = getKeys(payloads[0]).filter((key) => key in meta.fields) as FieldKey<E>[];
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

export function getProjectRelationKeys<E>(meta: EntityMeta<E>, project: QueryProject<E>): RelationKey<E>[] {
  const keys = getPositiveKeys(project);
  return keys.filter((key) => key in meta.relations) as RelationKey<E>[];
}

export function isProjectingRelations<E>(meta: EntityMeta<E>, project: QueryProject<E>): boolean {
  const keys = getPositiveKeys(project);
  return keys.some((key) => key in meta.relations);
}

function getPositiveKeys<E>(project: QueryProject<E>): Key<E>[] {
  if (Array.isArray(project)) {
    return project as Key<E>[];
  }
  return getKeys(project).filter((key) => project[key]) as Key<E>[];
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

export function augmentFilter<E>(
  meta: EntityMeta<E>,
  target: QueryFilter<E> = {},
  source: QueryFilter<E> = {},
): QueryFilter<E> {
  const targetComparison = getQueryFilterAsMap(meta, target);
  const sourceComparison = getQueryFilterAsMap(meta, source);
  return {
    ...targetComparison,
    ...sourceComparison,
  };
}

export function getQueryFilterAsMap<E>(meta: EntityMeta<E>, filter: QueryFilter<E> = {}): QueryFilterMap<E> {
  if (filter instanceof QueryRaw) {
    return { $and: [filter] } as QueryFilterMap<E>;
  }
  if (isIdFilter(filter)) {
    return {
      [meta.id]: filter,
    } as QueryFilterMap<E>;
  }
  return filter as QueryFilterMap<E>;
}

function isIdFilter<E>(filter: QueryFilter<E>): filter is IdValue<E> | IdValue<E>[] {
  const type = typeof filter;
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'bigint' ||
    typeof (filter as MongoId).toHexString === 'function' ||
    Array.isArray(filter)
  );
}
