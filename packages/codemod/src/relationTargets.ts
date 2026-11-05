import ts from 'typescript';
import { applyEdits, type Edit, inserted, original, removeFromList, replaced } from './edits.js';
import { decoratorName, namedProperty, RELATION_DECORATORS } from './syntax.js';

/** `@ManyToOne(() => User, { references })` from `@ManyToOne({ entity: () => User, references })`, the rest kept as written. */
function targetFirst(options: ts.ObjectLiteralExpression): readonly Edit[] {
  const entity = namedProperty(options, 'entity');
  if (!entity) return [];
  const target = original(ts.isPropertyAssignment(entity) ? entity.initializer : entity.name);
  if (options.properties.length === 1) return [replaced(options, [target])];
  return [inserted(options, [target, ', ']), ...removeFromList(options.properties, [entity], options.getSourceFile())];
}

/** Passes each relation decorator's target first, as `defineEntity`'s `rel.*` take it. Off the text the other passes wrote. */
export function toRelationTargets(fileName: string, text: string): string {
  if (!/@(?:OneToOne|ManyToOne|OneToMany|ManyToMany)\(\s*\{/.test(text)) return text;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression) && RELATION_DECORATORS.has(decoratorName(node))) {
      const [options, ...rest] = node.expression.arguments;
      if (options && !rest.length && ts.isObjectLiteralExpression(options)) {
        edits.push(...targetFirst(options));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return applyEdits(text, edits);
}
