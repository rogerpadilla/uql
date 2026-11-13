import { readsRelations } from '../dialect/abstractDialect.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import type { PolicySchema } from '../schema/types.js';
import {
  type ContextWhere,
  type EntityAccess,
  type EntityMeta,
  type EntityTriggerMeta,
  type FieldMeta,
  type PolicyMeta,
  type PolicyWhen,
  QuerySql,
} from '../type/index.js';
import { entityName } from '../util/object.util.js';
import {
  asWhere,
  bindContext,
  boundTransitions,
  type ContextRead,
  POLICY_OPS,
  movesRefused,
  POLICY_SIDES,
  policiesOf,
  project,
} from '../util/policy.util.js';
import { sql } from '../util/sql.js';
import { ownedName } from '../util/sql.util.js';
import { written } from '../util/triggerWrite.js';
import { UqlUsageError } from '../util/uqlError.js';
import { rowNames, sidedSql } from './triggerSql.js';

/** The command each statement a policy holds is, as `CREATE POLICY ... FOR` names it. */
const COMMANDS: Readonly<Record<EntityAccess, string>> = {
  read: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

/**
 * The policies a native pool's database holds `meta` to, each named for its table and label and ending in a hash of
 * its own SQL, as a trigger is: one `FOR ALL` where it holds every statement, else one per statement. See
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
  const read = contextReader(dialect, meta, columnType);
  return policiesOf(meta.policies).flatMap((policy, position) => {
    const label = policyLabel(policy, position);
    const predicate = (where: ContextWhere<object>) => {
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
      // `ALL` reads both rows, as an update does.
      const sides = POLICY_SIDES[op ?? 'update'];
      const using = sides.$old && predicate(project(policy.where, '$old'));
      const check = sides.$new && predicate(project(policy.where, '$new'));
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

/**
 * The triggers holding a native pool's database to `meta`'s transitions, which no policy can, as no `WITH CHECK` sees
 * the row as found: before each update, a row moving where none lets it is refused as `42501`, wherever row-level
 * security holds the role writing it. In the body, since Postgres takes no subquery in a trigger's `WHEN`.
 */
export function policyTriggers(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<object>,
  columnType: (field: FieldMeta) => string,
): EntityTriggerMeta<object>[] {
  if (!dialect.policies.database || !meta.policies?.length) {
    return [];
  }
  const read = contextReader(dialect, meta, columnType);
  const names = rowNames(dialect);
  const refusal = written({
    kind: 'refuse',
    message: movesRefused(entityName(meta)),
    sqlState: '42501',
  });
  return policiesOf(meta.policies).flatMap((policy, position) => {
    const moves = boundTransitions(meta, policy, read);
    if (!moves.length) {
      return [];
    }
    const held = moves.map((bound) => sidedSql(dialect, meta, asWhere(meta, bound), names)).join(' AND ');
    const condition = [dialect.rowSecurityApplies(meta), ...whenSql(dialect, policy.when), `(${held}) IS NOT TRUE`];
    const body = sql`IF ${sql.text(condition.join(' AND '))} THEN\n${refusal}\nEND IF;`;
    return [{ on: 'beforeUpdate', name: `${policyLabel(policy, position)}_update`, run: () => body }];
  });
}

/** A policy's label within its entity: its name, else its effect and position. */
function policyLabel(policy: PolicyMeta<object>, position: number): string {
  return policy.name ?? `${policy.effect}_${position}`;
}

/** Each context key a policy reads, as the database reads it off the transaction, typed as the field it meets. */
function contextReader(
  dialect: AbstractSqlDialect,
  meta: EntityMeta<object>,
  columnType: (field: FieldMeta) => string,
): ContextRead {
  return (ref, field) => {
    if (!field) {
      throw new UqlUsageError(`a policy of '${entityName(meta)}' compares context key '${ref.$context}' with no field`);
    }
    const read = dialect.contextRead(ref.$context, columnType(field));
    return new QuerySql(() => read);
  };
}

/** What removes a policy from `table`, a name qualified where its schema is. */
export function dropPolicy(dialect: AbstractSqlDialect, table: string, name: string): string {
  return `DROP POLICY IF EXISTS ${dialect.escapeId(name)} ON ${dialect.escapeId(table)}`;
}

/**
 * A `when` as the context comparisons it is, each read as text, as the binding sends every value. The pool's role key
 * reads the role itself, not `TO`: see architecture/row-level-security.md.
 */
function whenSql(dialect: AbstractSqlDialect, when: PolicyWhen | undefined): string[] {
  const { role } = dialect.policies;
  return Object.entries(when ?? {}).map(([key, value]) => {
    const values = [value].flat().map((it) => dialect.escape(String(it)));
    const read = key === role ? dialect.currentRole : dialect.contextRead(key, 'text');
    return values.length ? `${read} IN (${values.join(', ')})` : 'false';
  });
}
