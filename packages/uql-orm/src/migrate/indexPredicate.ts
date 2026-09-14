import type { DialectName, EntityWhereMeta } from '../type/index.js';
import { QueryRaw } from '../type/queryRaw.js';
import { isOperatorObject } from '../util/object.util.js';

type PredicateGrammar = {
  readonly rootOps: ReadonlySet<string>;
  readonly fieldOps: ReadonlySet<string>;
  readonly jsonPaths: boolean;
};

/**
 * The `$where` a partial index takes, on the engines where that is less than a query's: SQL Server's
 * `CREATE INDEX` `<filter_predicate>` (comparisons and `IN` on plain columns, joined by `AND`), and
 * MongoDB's `partialFilterExpression` (https://www.mongodb.com/docs/manual/core/index-partial/).
 */
const PREDICATE_GRAMMARS: Partial<Record<DialectName, PredicateGrammar>> = {
  mssql: {
    rootOps: new Set(['$and']),
    fieldOps: new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$isNull', '$isNotNull']),
    jsonPaths: false,
  },
  mongodb: {
    rootOps: new Set(['$and', '$or']),
    fieldOps: new Set(['$eq', '$gt', '$gte', '$lt', '$lte', '$between', '$in']),
    jsonPaths: true,
  },
};

/**
 * Refuses a partial index's predicate reaching past what the engine takes, before it compiles to what
 * only the server would reject, naming the operator as its author wrote it. A `raw` one is left to the server.
 */
export function assertIndexPredicate<E>(where: EntityWhereMeta<E>, dialectName: DialectName, indexName: string): void {
  const grammar = PREDICATE_GRAMMARS[dialectName];
  const refused = grammar && !(where instanceof QueryRaw) ? refusedOperator(where, grammar) : undefined;
  if (refused) {
    throw refusedIndexPredicate(dialectName, refused, indexName);
  }
}

/** What refusing any part of a partial index's predicate reports. */
export function refusedIndexPredicate(dialectName: string, part: string, indexName: string): TypeError {
  return new TypeError(`${dialectName} does not support ${part} in a partial index predicate (index "${indexName}")`);
}

/** The first part of `where` outside `grammar`, depth-first; a `raw` clause is left alone. */
function refusedOperator(where: object, grammar: PredicateGrammar): string | undefined {
  return Object.entries(where)
    .map(([key, value]) => {
      if (key.includes('.') && !grammar.jsonPaths) {
        return 'a JSON path';
      }
      if (!key.startsWith('$')) {
        return isOperatorObject(value) ? Object.keys(value).find((op) => !grammar.fieldOps.has(op)) : undefined;
      }
      if (!grammar.rootOps.has(key)) {
        return key;
      }
      const clauses = Array.isArray(value) ? value.filter((clause) => !(clause instanceof QueryRaw)) : [];
      return clauses.map((clause) => refusedOperator(clause, grammar)).find(Boolean);
    })
    .find(Boolean);
}
