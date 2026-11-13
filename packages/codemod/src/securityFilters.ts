import ts from 'typescript';
import { type Finding, formatFindings } from './context.js';
import { type Edit, editedText, original, type Part, reparsedAgain } from './edits.js';
import { importEdits } from './imports.js';
import { isCallback, memberAccess } from './keyMaps.js';
import {
  chainOf,
  identifierText,
  isUndefined,
  namedProperty,
  objectLiteral,
  propertyKey,
  propertyValue,
  unwrapped,
} from './syntax.js';

/** What a security filter states that its policy keeps (`where`, `ops`) or drops: any other leaves it to a human. */
const SECURITY_OPTIONS = new Set<string | undefined>(['where', 'security', 'ops', 'onMissing', 'default']);

/** A filters literal, whether its entity states policies already, and the edit writing its kept filters and policies. */
type Filters = {
  readonly literal: ts.ObjectLiteralExpression;
  readonly policiesStated: boolean;
  readonly write: (kept: readonly ts.ObjectLiteralElementLike[], policies: string) => Edit;
};

/**
 * Each `security: true` filter that reads the context as data, as the `must` policy replacing it: in `@Entity`'s and
 * `defineEntity`'s `filters`, a `.filters()` section becoming `.policies()`. Off the text the earlier passes wrote,
 * so `@Filter` and `defineFilter` are folded in and every filter says `where`. Reports the rest, and an `onMissing`
 * no filter takes now.
 */
export function toPolicies(
  fileName: string,
  text: string,
  locate: (at: number) => string,
): { readonly text: string; readonly unresolved: readonly string[] } {
  if (!text.includes('security') && !text.includes('onMissing')) {
    return { text, unresolved: [] };
  }
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  const findings: Finding[] = [];
  const report = (node: ts.Node, message: string) => findings.push({ node, message });
  const visit = (node: ts.Node): void => {
    const filters = filtersOf(node);
    const split = filters && splitFilters(filters.literal, report);
    if (filters && split && filters.policiesStated) {
      report(node, 'move its security filters into the policies it states by hand');
    } else if (filters && split) {
      edits.push(filters.write(split.kept, `[${split.policies.join(', ')}]`));
    }
    if (!filters) {
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  const written = edits.length
    ? reparsedAgain(fileName, editedText(text, edits), (edited) =>
        importEdits(edited, new Set(['$context']), new Set()),
      ).text
    : text;
  return { text: written, unresolved: formatFindings(findings, locate) };
}

/** The filters `node` declares: an entity's `filters` option, or a `defineEntity(...).filters({ ... })` section. */
function filtersOf(node: ts.Node): Filters | undefined {
  if (
    ts.isPropertyAssignment(node) &&
    ts.isObjectLiteralExpression(node.parent) &&
    propertyKey(node.name) === 'filters'
  ) {
    const literal = objectLiteral(node.initializer);
    return (
      literal && {
        literal,
        policiesStated: namedProperty(node.parent, 'policies') !== undefined,
        write: (kept, policies) => ({
          start: node.getStart(),
          end: node.getEnd(),
          text: [...(kept.length ? ['filters: ', ...braced(kept), ', '] : []), `policies: ${policies}`],
        }),
      }
    );
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const { name } = node.expression;
  const literal = name.text === 'filters' ? objectLiteral(node.arguments[0]) : undefined;
  if (!literal) {
    return undefined;
  }
  const { root, methods } = chainOf(node);
  if (!ts.isCallExpression(root) || identifierText(root.expression) !== 'defineEntity') {
    return undefined;
  }
  return {
    literal,
    policiesStated: methods.some((method) => method.name === 'policies'),
    write: (kept, policies) => ({
      start: name.getStart(),
      end: node.getEnd(),
      text: [...(kept.length ? ['filters(', ...braced(kept), ').'] : []), `policies(${policies})`],
    }),
  };
}

/**
 * The filters `literal` keeps, and the policies its security filters become; `undefined` where none becomes one.
 * Reports a security filter it cannot read as data, and an `onMissing` no filter takes now.
 */
function splitFilters(
  literal: ts.ObjectLiteralExpression,
  report: (node: ts.Node, message: string) => void,
): { readonly kept: readonly ts.ObjectLiteralElementLike[]; readonly policies: readonly string[] } | undefined {
  const kept: ts.ObjectLiteralElementLike[] = [];
  const policies: string[] = [];
  for (const prop of literal.properties) {
    const options = ts.isPropertyAssignment(prop) ? objectLiteral(prop.initializer) : undefined;
    const name = ts.isPropertyAssignment(prop) ? propertyKey(prop.name) : undefined;
    const security = options && namedProperty(options, 'security') !== undefined;
    const policy = security ? policyOf(options) : undefined;
    if (policy) {
      policies.push(policy);
      continue;
    }
    if (security) {
      report(
        prop,
        `security filter '${name}' is a policy now: declare it in the entity's 'policies', see https://uql-orm.dev/upgrade-guide`,
      );
    } else if (options && namedProperty(options, 'onMissing')) {
      report(
        prop,
        `filter '${name}' gives 'onMissing', which no filter takes now: one is skipped where the context lacks a key it reads, so remove it`,
      );
    }
    kept.push(prop);
  }
  return policies.length ? { kept, policies } : undefined;
}

/** The `must` policy a security filter's options become, keeping their `ops`, where they read the context as data. */
function policyOf(filter: ts.ObjectLiteralExpression): string | undefined {
  const where = propertyValue(filter, 'where');
  const known = filter.properties.every(
    (prop) => ts.isPropertyAssignment(prop) && SECURITY_OPTIONS.has(propertyKey(prop.name)),
  );
  const must =
    propertyValue(filter, 'security')?.kind === ts.SyntaxKind.TrueKeyword && known && where ? mustOf(where) : undefined;
  const ops = propertyValue(filter, 'ops');
  return must && `{ must: ${must}${ops ? `, ops: ${ops.getText()}` : ''} }`;
}

/**
 * A security filter's `where` as a policy's: a literal as it is, and a callback each of whose fields reads a context
 * key, `(ctx) => ({ companyId: ctx?.tenantId })`, where it tests only that those keys are there, as data.
 */
function mustOf(where: ts.Expression): string | undefined {
  if (ts.isObjectLiteralExpression(where)) {
    return where.getText();
  }
  if (!isCallback(where) || where.parameters.length !== 1) {
    return undefined;
  }
  const context = identifierText(where.parameters[0]!.name);
  const body = returned(where.body);
  if (!context || !body) {
    return undefined;
  }
  const guarded = ts.isConditionalExpression(body) && isUndefined(body.whenFalse);
  const scope = unwrapped(guarded ? body.whenTrue : body);
  if (!ts.isObjectLiteralExpression(scope) || !scope.properties.length) {
    return undefined;
  }
  const entries = scope.properties.map((prop) => {
    if (!ts.isPropertyAssignment(prop)) {
      return undefined;
    }
    const key = contextKey(prop.initializer, context);
    return key && ([prop.name.getText(), key] as const);
  });
  if (!entries.every((entry) => entry !== undefined)) {
    return undefined;
  }
  const keys = new Set(entries.map(([, key]) => key));
  const tested = guarded ? presenceKeys(body.condition, context) : [];
  if (!tested || !tested.every((key) => keys.has(key))) {
    return undefined;
  }
  return `{ ${entries.map(([field, key]) => `${field}: ${memberAccess('$context', key)}`).join(', ')} }`;
}

/** What a function body returns: its expression, or a block's one `return`. */
function returned(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) {
    return unwrapped(body);
  }
  const [statement, ...rest] = body.statements;
  return statement && !rest.length && ts.isReturnStatement(statement) && statement.expression
    ? unwrapped(statement.expression)
    : undefined;
}

/** The context key `value` reads off `context`, `ctx.tenantId`, `ctx?.tenantId` or `ctx!.tenantId`. */
function contextKey(value: ts.Expression, context: string): string | undefined {
  const access = unwrapped(value);
  return ts.isPropertyAccessExpression(access) && identifierText(unwrapped(access.expression)) === context
    ? access.name.text
    : undefined;
}

/**
 * The keys a condition tests are there, as `ctx?.tenantId`, `ctx?.tenantId != null` or `!== undefined`, joined by
 * `&&`; `undefined` for a condition testing anything else.
 */
function presenceKeys(condition: ts.Expression, context: string): string[] | undefined {
  const test = unwrapped(condition);
  if (!ts.isBinaryExpression(test)) {
    const key = contextKey(test, context);
    return key ? [key] : undefined;
  }
  const { operatorToken: op, left, right } = test;
  if (op.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const [a, b] = [presenceKeys(left, context), presenceKeys(right, context)];
    return a && b && [...a, ...b];
  }
  const absent = isUndefined(right) || right.kind === ts.SyntaxKind.NullKeyword;
  const unequal =
    op.kind === ts.SyntaxKind.ExclamationEqualsToken || op.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  const key = absent && unequal ? contextKey(left, context) : undefined;
  return key ? [key] : undefined;
}

/** `{ a, b }`, each property as it was written. */
function braced(props: readonly ts.ObjectLiteralElementLike[]): Part[] {
  return ['{ ', ...props.flatMap((prop, index) => [...(index ? [', '] : []), original(prop)]), ' }'];
}
