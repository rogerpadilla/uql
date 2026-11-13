import { readsRelations } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { PolicySchema } from '../schema/types.js';
import {
  type EntityAccess,
  type EntityMeta,
  type FieldMeta,
  type PolicyWhen,
  type PolicyWhere,
  QuerySql,
} from '../type/index.js';
import { entityName } from '../util/object.util.js';
import { asWhere, bindContext, type ContextRead, POLICY_OPS, policiesOf } from '../util/policy.util.js';
import { ownedName } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';

/** The command each statement a policy holds is, as `CREATE POLICY ... FOR` names it. */
const COMMANDS: Readonly<Record<EntityAccess, string>> = {
  read: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

/**
 * The policies a native pool's database holds `meta` to, each named for its table and label and ending in a hash of
 * its own SQL, as a trigger is: one `FOR ALL` where it holds every statement, else one per statement. The table's
 * row-level security is switched with its first policy and its last, as `TableDdl.rowSecurity` says. See
 * architecture/row-level-security.md.
 */
export function renderPolicies(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<object>,
  columnType: (field: FieldMeta) => string,
): PolicySchema[] {
  if (!dialect.policies.database || !meta.policies?.length) {
    return [];
  }
  const table = dialect.resolveTableAlias(meta);
  const target = dialect.escapedTableName(meta);
  const read: ContextRead = (ref, field) => {
    if (!field) {
      throw new UqlUsageError(`a policy of '${entityName(meta)}' compares context key '${ref.$context}' with no field`);
    }
    const sql = dialect.contextRead(ref.$context, columnType(field));
    return new QuerySql(() => sql);
  };
  return policiesOf(meta.policies).flatMap((policy, position) => {
    const label = policy.name ?? `${policy.effect}_${position}`;
    const predicate = (where: PolicyWhere<object>) => {
      const bound = asWhere(meta, bindContext(meta, where, read));
      const { rowSecurity } = dialect.features;
      if (!(rowSecurity && rowSecurity.subqueries) && readsRelations(meta, bound)) {
        throw new UqlUsageError(
          `${dialect.engineName} takes no subquery in a policy, so '${entityName(meta)}' policy '${label}' cannot read a relation there: leave policies unset on this pool, for uql to hold them`,
        );
      }
      return (
        [...whenSql(dialect, policy.when), dialect.compileDdl(bound, meta.entity)].filter(Boolean).join(' AND ') ||
        'true'
      );
    };
    const commands: [string, EntityAccess | undefined][] = POLICY_OPS.every((op) => policy.ops.includes(op))
      ? [['ALL', undefined]]
      : policy.ops.map((op) => [COMMANDS[op], op]);
    return commands.map(([command, op]) => {
      const using = command === 'INSERT' ? undefined : predicate(policy.where);
      const check = writes(command) ? predicate(policy.check ?? policy.where) : undefined;
      const create = (name: string) =>
        [
          `CREATE POLICY ${dialect.escapeId(name)} ON ${target} AS ${policy.effect === 'allow' ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${command} TO PUBLIC`,
          ...(using === undefined ? [] : [`USING (${using})`]),
          ...(check === undefined ? [] : [`WITH CHECK (${check})`]),
        ].join(' ');
      const name = ownedName(table, op ? `${label}_${op}` : label, create(''));
      return { name, statements: [create(name)] };
    });
  });
}

/** Whether `command` writes rows, which `WITH CHECK` holds. */
function writes(command: string): boolean {
  return command === 'ALL' || command === 'INSERT' || command === 'UPDATE';
}

/** What removes a policy from `table`, a name qualified where its schema is. */
export function dropPolicy(dialect: AbstractSqlDialect, table: string, name: string): string {
  return `DROP POLICY IF EXISTS ${dialect.escapeId(name)} ON ${dialect.escapeId(table)}`;
}

/** A `when` as the context comparisons it is, each read as text, as the binding sends every value. */
function whenSql(dialect: AbstractSqlDialect, when: PolicyWhen | undefined): string[] {
  return Object.entries(when ?? {}).map(([key, value]) => {
    const values = [value].flat().map((it) => dialect.escape(String(it)));
    return values.length ? `${dialect.contextRead(key, 'text')} IN (${values.join(', ')})` : 'false';
  });
}
