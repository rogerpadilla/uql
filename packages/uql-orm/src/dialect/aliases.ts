/**
 * Every identifier UQL invents for itself: a column a statement answers in, a derived table it wraps
 * a set in, a temporary field a pipeline parks a value on.
 *
 * All of them share the `_uql` prefix, which is what keeps them off a user's own column or field, and
 * all of them are declared here rather than beside the code that emits them: the end that writes one
 * and the end that reads it back are usually in different modules, and a drift between the two fails
 * silently - a count of zero, or an ordering that ranks everything equal. Collected in one file so
 * the whole reserved namespace can be read at a glance before a new name is added to it.
 */

/** The column every internally-built count answers in: `COUNT(*)`, a grouped tally, a `$count` stage. */
export const COUNT_ALIAS = '_uql_count';

/** The column a paged read carries its own unpaged total in, from `COUNT(*) OVER ()`. */
export const TOTAL_ALIAS = '_uql_total';

/** The derived table a `$distinct` count wraps its deduplicated set in. MySQL requires the alias. */
export const DISTINCT_DERIVED_ALIAS = '_uql_distinct';

/** Prefix for the alias an exploded JSON array element is read through. */
export const JSON_ELEM_ALIAS_PREFIX = '_uql_elem';

/** The alias a `$pull` reads its surviving elements through, kept distinct from {@link JSON_ELEM_ALIAS_PREFIX}. */
export const JSON_PULL_ALIAS = '_uql_pull';

/** Prefix for the field a MongoDB relation lookup parks its result on, one per condition. */
export const REL_TEMP_PREFIX = '_uql_rel_';

/** The field a ManyToMany lookup nests its target match under, inside the junction's own pipeline. */
export const REL_NESTED_KEY = '_uql_target';

/**
 * Where a `$sort` by a relation's size parks its tally until the ordering has run. A function, so the
 * `$sort` that names the field and the stage that produces it cannot spell it differently - MongoDB
 * ranks a field that is not there as all-equal rather than failing, so a drift would go unnoticed.
 */
export function sortCountField(relKey: string): string {
  return `_uql_sort_count_${relKey}`;
}
