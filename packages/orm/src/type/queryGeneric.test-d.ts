/**
 * A query built in code generic over its entity, where a key is a type parameter rather than a literal:
 * TypeScript widens `{ [key]: 'asc' }` to an index signature no entity map accepts, so `keyOf` and
 * `sortOf` carry the key instead. Type-checked by `bun run ts` only.
 */
import { keyOf } from '../entity/index.js';
import { sortOf } from '../util/index.js';
import type { FieldKeyOf, KeyMap, Querier, QuerySortMap, Type } from './index.js';

class Author {
  id?: number;
  name?: string;
}

class Note {
  id?: number;
  body?: string;
  createdAt?: Date;
  answeredAt?: Date | null;
  author?: Author;
}

declare const querier: Querier;

/** The oldest rows first by a date the caller names, and that date read off each of them. */
function oldestFirst<E extends object, K extends FieldKeyOf<E, Date>>(entity: Type<E>, since: (keys: KeyMap<E>) => K) {
  const key = keyOf(since);
  return async () => {
    const rows = await querier.findMany(entity, { $sort: sortOf<E>([[key, 'asc']]) });
    return rows.map((row) => row[key]);
  };
}

export const waiting = oldestFirst(Note, (note) => note.answeredAt);

// @ts-expect-error a string field is no date
oldestFirst(Note, (note) => note.body);

export function widened<E, K extends FieldKeyOf<E, Date>>(key: K): QuerySortMap<E> {
  // @ts-expect-error a computed key of a type parameter widens to `{ [x: string]: string }`
  return { [key]: 'asc' };
}

export const body: 'body' = keyOf((note: KeyMap<Note>) => note.body);

// @ts-expect-error a selector reads one member, by name
keyOf((note: KeyMap<Note>) => note.missing);

export const sorted: QuerySortMap<Note> = sortOf([
  ['createdAt', 'desc'],
  ['id', 1],
]);

// @ts-expect-error a key the entity lacks
sortOf<Note>([['missing', 'asc']]);

// @ts-expect-error a relation sorts by its own fields, through a `$sort` map
sortOf<Note>([['author', 'asc']]);

// @ts-expect-error a direction `$sort` takes
sortOf<Note>([['id', 'up']]);
