import { EntityMeta, FieldKey, QueryProject, CascadeType, RelationKey, FieldOptions, Key } from '@uql/core/type';
import { getKeys } from '@uql/core/util';

type CallbackKey = keyof Pick<FieldOptions, 'onInsert' | 'onUpdate'>;

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

export function filterFields<E>(meta: EntityMeta<E>, payload: E): FieldKey<E>[] {
  return getKeys(payload).filter((key) => meta.fields[key]) as FieldKey<E>[];
}

export function filterRelations<E>(meta: EntityMeta<E>, payload: E, action?: CascadeType): RelationKey<E>[] {
  const keys = getProjectArray(payload);
  return keys.filter((key) => {
    const relOpts = meta.relations[key as RelationKey<E>];
    return relOpts && isCascadable(action, relOpts.cascade);
  }) as RelationKey<E>[];
}

export function filterProjectRelations<E>(meta: EntityMeta<E>, project: QueryProject<E>): RelationKey<E>[] {
  const keys = getProjectArray(project);
  return keys.filter((key) => project[key as string] && meta.relations[key as RelationKey<E>]) as RelationKey<E>[];
}

export function hasProjectRelations<E>(meta: EntityMeta<E>, project: QueryProject<E>): boolean {
  const keys = getProjectArray(project);
  return keys.some((key) => meta.relations[key as RelationKey<E>]);
}

export function isCascadable(action: CascadeType, configuration?: boolean | readonly CascadeType[]): boolean {
  if (typeof configuration === 'boolean') {
    return configuration;
  }
  return configuration?.includes(action);
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

function getProjectArray<E>(project: QueryProject<E>): Key<E>[] {
  if (Array.isArray(project)) {
    return project.filter((it) => typeof it === 'string') as Key<E>[];
  }
  return getKeys(project).filter((key) => project[key]) as Key<E>[];
}
