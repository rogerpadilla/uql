// Every identifier UQL invents, `_uql`-prefixed to stay off a user's own, collected in one place:
// the ends writing and reading one sit in different modules, and a drift between them fails silently.

/** The column every internally-built count answers in: `COUNT(*)`, a grouped tally, a `$count` stage. */
export const COUNT_ALIAS = '_uql_count';

/** The column a paged read carries its own unpaged total in, from `COUNT(*) OVER ()`. */
export const TOTAL_ALIAS = '_uql_total';

/** The derived table a count wraps the rows it counts in: a page, or a `$distinct` set. MySQL requires the alias. */
export const COUNTED_ROWS_ALIAS = '_uql_rows';

/** The derived table a capped relation aggregate reads: the page is taken first, then aggregated over. */
export const AGGREGATE_PAGE_ALIAS = '_uql_page';

/**
 * What an aggregate answers under: the column a capped page carries out for the aggregate wrapping it,
 * and the field a MongoDB `$group` or `$count` leaves its value in. One name, since both ends of each
 * are written and read here.
 */
export const AGGREGATE_VALUE_ALIAS = '_uql_value';

/** The row a Postgres relation aggregates whole: a LATERAL projection of the columns it answers under. */
export const RELATION_ROW_ALIAS = '_uql_row';

/** The alias an exploded JSON array element is read through, `_uql_elem_2` and on where one nests in another. */
export const JSON_ELEM_ALIAS = '_uql_elem';

/** The alias a `$pull` reads its surviving elements through, kept distinct from {@link JSON_ELEM_ALIAS}. */
export const JSON_PULL_ALIAS = '_uql_pull';

/** Prefix for the field a MongoDB relation lookup parks its result on, one per condition. */
export const REL_TEMP_PREFIX = '_uql_rel_';

/** The field a ManyToMany lookup nests its target match under, inside the junction's own pipeline. */
export const REL_NESTED_KEY = '_uql_target';

/**
 * The alias MySQL's upsert gives the row being inserted, so its `ON DUPLICATE KEY UPDATE`
 * assignments read `_uql_new.col` instead of the deprecated `VALUES(col)`. MariaDB has no such
 * syntax and keeps `VALUES(col)`.
 */
export const UPSERT_NEW_ROW_ALIAS = '_uql_new';

/** The row source a `MERGE` upsert reads its incoming values from, on SQL Server and Oracle. */
export const UPSERT_SOURCE_ALIAS = '_uql_src';

/**
 * Where a `$sort` by a relation's size parks its tally until the ordering has run. A function, so the
 * `$sort` that names the field and the stage that produces it cannot spell it differently - MongoDB
 * ranks a field that is not there as all-equal rather than failing, so a drift would go unnoticed.
 */
export function sortCountField(relKey: string): string {
  return `_uql_sort_count_${relKey}`;
}

/**
 * The column a relation's rows carry one sort term out in, beside the columns they answer under, for
 * the aggregate reading them to order by: `_uql_sort_createdAt`.
 */
export function relationSortColumn(path: string): string {
  return `_uql_sort_${path}`;
}
