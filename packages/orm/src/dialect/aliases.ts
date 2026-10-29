import type { RelationAggregateSpec } from '../type/index.js';

// Every identifier UQL invents, `_uql`-prefixed to stay off a user's own, collected in one place:
// the ends writing and reading one sit in different modules, and a drift between them fails silently.

/**
 * What every schema object uql creates is named from, so a hand-written trigger or function is never
 * offered for dropping: ownership is the name, since no engine records who created one.
 */
export const OWNED_PREFIX = '_uql';

/** The column a paged read carries its own unpaged total in, from `COUNT(*) OVER ()`. */
export const TOTAL_ALIAS = `${OWNED_PREFIX}_total`;

/**
 * The derived table a statement wraps the rows it counts or aggregates in: a page, a `$distinct` set, or
 * rows computing an inlined field an aggregate names. MySQL requires the alias.
 */
export const ROWS_ALIAS = `${OWNED_PREFIX}_rows`;

/** The derived table a capped relation aggregate reads: the page is taken first, then aggregated over. */
export const AGGREGATE_PAGE_ALIAS = `${OWNED_PREFIX}_page`;

/**
 * The one value a statement that aggregates answers under: a `COUNT(*)` or an estimate, the column a
 * capped page carries out for the aggregate wrapping it, and the field a MongoDB `$group` or `$count`
 * leaves its result in. One name, since both ends of each are written and read here.
 */
export const AGGREGATE_VALUE_ALIAS = `${OWNED_PREFIX}_value`;

/** Beside each MongoDB `$sum`, how many values it read: `$sum` answers 0 over none, where SQL answers null. */
export const SUM_COUNT_ALIAS = `${OWNED_PREFIX}_count`;

/** The row a Postgres relation aggregates whole: a LATERAL projection of the columns it answers under. */
export const RELATION_ROW_ALIAS = `${OWNED_PREFIX}_row`;

/** The alias an exploded JSON array element is read through, `_uql_elem_2` and on where one nests in another. */
export const JSON_ELEM_ALIAS = `${OWNED_PREFIX}_elem`;

/** The alias a `$pull` reads its surviving elements through, kept distinct from {@link JSON_ELEM_ALIAS}. */
export const JSON_PULL_ALIAS = `${OWNED_PREFIX}_pull`;

/** The key a JSON write aims at where it writes nothing, there being none by that name, nor any key in an array. */
export const JSON_SKIP_KEY = `${OWNED_PREFIX}_skip`;

/** What a savepoint the querier names is called, its depth appended. */
export const SAVEPOINT_PREFIX = `${OWNED_PREFIX}_sp`;

/** The cursor a stream declares. Suffixed per call, so two streams on one connection cannot collide. */
export const CURSOR_ALIAS = `${OWNED_PREFIX}_cursor`;

/** The SQL Server table variable an `OUTPUT` fills. */
export const OUTPUT_TABLE = `@${OWNED_PREFIX}_output`;

/** What SQL Server's report of a write's rows reads {@link OUTPUT_TABLE} as, the table its fields are projected off. */
export const OUTPUT_ALIAS = `${OWNED_PREFIX}_output`;

/** The field a MongoDB `$sort` by `$text` reads `textScore` from where it projects none, taken back out after. */
export const TEXT_SCORE_ALIAS = `${OWNED_PREFIX}_text_score`;

/** A relation's row's distance from the vector its `$sort` ranks by, where it projects none. */
export const NEAREST_DISTANCE_ALIAS = `${OWNED_PREFIX}_nearest`;

/**
 * The field a MongoDB `$sort` placing nulls orders by first: 1 where the value is null or missing, 0
 * where it is not. MongoDB takes no `NULLS FIRST`, so the placement is this flag plus the sort on it.
 * A dot becomes `_o` and an underscore `__`, so two paths such as `a.b` and `a_b` never share a flag.
 */
export function nullsSortField(path: string): string {
  return `${OWNED_PREFIX}_nulls_${path.replace(/[._]/g, (char) => (char === '.' ? '_o' : '__'))}`;
}

/** The field a MongoDB lookup parks its result on, named by what it reads so two lookups alive at once cannot share one. */
export function relTempField(kind: 'cond' | 'field' | 'sort' | 'count' | 'rel', name: string | number): string {
  return `${OWNED_PREFIX}_rel_${kind}_${name}`;
}

/** Prefix for the field a MongoDB lookup puts a relation's rows on where a stored field has the relation's name. */
export const REL_FIELD_PREFIX = `${OWNED_PREFIX}_joined_`;

/** The field a ManyToMany lookup nests its target match under, inside the junction's own pipeline. */
export const REL_NESTED_KEY = `${OWNED_PREFIX}_target`;

/**
 * The alias MySQL's upsert gives the row being inserted, so its `ON DUPLICATE KEY UPDATE`
 * assignments read `_uql_new.col` instead of the deprecated `VALUES(col)`. MariaDB has no such
 * syntax and reads `VALUE(col)`.
 */
export const UPSERT_NEW_ROW_ALIAS = `${OWNED_PREFIX}_new`;

/** The row source a `MERGE` upsert reads its incoming values from, on SQL Server and Oracle. */
export const UPSERT_SOURCE_ALIAS = `${OWNED_PREFIX}_src`;

/**
 * Where a `$sort` by a relation's aggregate - its size, or its nearest row - parks the value until the
 * ordering has run. A function, so the `$sort` that names the field and the stage that produces it cannot
 * spell it differently - MongoDB ranks a field that is not there as all-equal, so a drift would go unnoticed.
 */
export function sortAggregateField({ op, relation, field }: RelationAggregateSpec): string {
  return `${OWNED_PREFIX}_sort_${op.slice(1)}_${relation}${field ? `_${field}` : ''}`;
}

/**
 * The column a relation's rows carry one sort term out in, beside the columns they answer under, for
 * the aggregate reading them to order by: `_uql_sort_createdAt`.
 */
export function relationSortColumn(path: string): string {
  return `${OWNED_PREFIX}_sort_${path}`;
}
