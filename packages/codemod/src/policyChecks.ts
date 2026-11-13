import ts from 'typescript';
import { type Finding, formatFindings } from './context.js';
import { applyEdits, type Edit, original, removeFromList, replaced } from './edits.js';
import { identifierText, propertyAssignment, propertyValue } from './syntax.js';

/** What `explainPolicies` answered each side as, and what it answers it as now. */
const EXPLAINED: Readonly<Record<string, string>> = { where: '$old', check: '$new' };

/**
 * Each policy stating `check`, as the predicate it means: `{ allow: W, check: C }` reads the found row by `W` and the
 * written one by `C`, so it is `{ allow: { $old: W, $new: C } }`, wherever the policy literal is written. Reads of
 * `explainPolicies` go to their new sides; a destructuring of them is reported.
 */
export function toSidedPolicies(
  fileName: string,
  text: string,
  locate: (at: number) => string,
): { readonly text: string; readonly unresolved: readonly string[] } {
  if (!text.includes('uql-orm') || (!text.includes('check') && !text.includes('explainPolicies'))) {
    return { text, unresolved: [] };
  }
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const sided = ts.isObjectLiteralExpression(node) ? sidedPolicy(node, source) : undefined;
    if (sided) {
      edits.push(...sided);
      return;
    }
    const renamed = ts.isPropertyAccessExpression(node) && explains(node.expression) && EXPLAINED[node.name.text];
    if (renamed) {
      edits.push(replaced(node.name, renamed));
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      explains(node.initializer)
    ) {
      findings.push({
        node,
        message:
          "explainPolicies answers '$old' and '$new' now, where it answered 'where' and 'check': rename what you read",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { text: edits.length ? applyEdits(text, edits) : text, unresolved: formatFindings(findings, locate) };
}

/**
 * The edits folding `policy`'s `check` into its predicate, the rest of it kept as written, or `undefined` for one
 * stating none.
 */
function sidedPolicy(policy: ts.ObjectLiteralExpression, source: ts.SourceFile): readonly Edit[] | undefined {
  const check = propertyAssignment(policy, 'check');
  const found = propertyValue(policy, 'allow') ?? propertyValue(policy, 'must');
  if (!check || !found) {
    return undefined;
  }
  const every = ts.isObjectLiteralExpression(found) && !found.properties.length;
  const written = ['$new: ', original(check.initializer)];
  const predicate = every ? ['{ ', ...written, ' }'] : ['{ $old: ', original(found), ', ', ...written, ' }'];
  return [replaced(found, predicate), ...removeFromList(policy.properties, [check], source)];
}

/** Whether `node` calls `explainPolicies`. */
function explains(node: ts.Expression): boolean {
  return ts.isCallExpression(node) && identifierText(node.expression) === 'explainPolicies';
}
