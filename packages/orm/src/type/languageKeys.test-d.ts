/**
 * The `$` convention (AGENTS.md): every key or reference the query language defines starts with `$`, and no option a
 * definition or a call takes does. Type-checked by `bun run ts` only.
 */

import type {
  ContextKeyRef,
  EntityOptions,
  FieldOptions,
  FilterOptions,
  PolicyOptions,
  QueryAggregateOp,
  QueryGroupOp,
  QueryOptions,
  QueryWhereFieldOp,
  TriggerOptions,
} from './index.js';
import type { QUERY_CLAUSES } from './query.js';

type Language = `$${string}`;

/** `true` where every one of `K` is a language key, else the ones that are not. */
type AllLanguage<K> = [Exclude<K, Language>] extends [never] ? true : Exclude<K, Language>;

/** `true` where none of `K` is a language key, else the ones that are. */
type NoLanguage<K> = [Extract<K, Language>] extends [never] ? true : Extract<K, Language>;

export const languageKeys: [
  AllLanguage<keyof typeof QUERY_CLAUSES>,
  AllLanguage<QueryWhereFieldOp>,
  AllLanguage<QueryGroupOp>,
  AllLanguage<QueryAggregateOp>,
  AllLanguage<keyof ContextKeyRef>,
] = [true, true, true, true, true];

export const optionKeys: [
  NoLanguage<keyof EntityOptions>,
  NoLanguage<keyof FieldOptions>,
  NoLanguage<keyof FilterOptions>,
  NoLanguage<keyof PolicyOptions<object>>,
  NoLanguage<keyof TriggerOptions<object>>,
  NoLanguage<keyof QueryOptions>,
] = [true, true, true, true, true, true];
