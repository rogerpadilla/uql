import ts from 'typescript';
import { type Context, constructedType, memberNames, type Owner, ownerOf, propertyNames } from './context.js';
import { type Edit, inserted, replaced } from './edits.js';
import { isSqlCall } from './entitySql.js';
import { uqlImport, usesOf } from './imports.js';
import { type Edits, memberAccess } from './keyMaps.js';
import { identifierText, propertyKey, propertyValue } from './syntax.js';

/**
 * Rewrites each `col('x')` into the ref it names - `product.x` in a `computed` callback, `refs(Item).x` in a
 * statement - where the entity its SQL renders against, and a member named `x`, can be told from here. Every
 * other use is reported. Returns `col` as a dead import once no use is left.
 */
export function rewriteColumnRefs(ctx: Context): readonly string[] {
  const element = uqlImport(ctx.source, 'col');
  if (!element) {
    return [];
  }
  const computed = new Map<ts.TaggedTemplateExpression, { owner: Owner; calls: ts.CallExpression[] }>();
  const unread: ts.Node[] = [];
  for (const use of usesOf(ctx.source, element.name, ctx.checker)) {
    const call = ts.isCallExpression(use.parent) && use.parent.expression === use ? use.parent : undefined;
    const sql = call && ts.findAncestor(call, (node) => isSqlCall(node, ctx.checker));
    const option = sql?.parent;
    const owner =
      option && ts.isPropertyAssignment(option) && isComputedOption(option) ? computedOwner(option) : undefined;
    const edit = call && !owner ? statementRefEdit(call, ctx) : undefined;
    if (call && sql && ts.isTaggedTemplateExpression(sql) && owner) {
      computed.set(sql, { owner, calls: [...(computed.get(sql)?.calls ?? []), call] });
    } else if (edit) {
      ctx.edits.push(edit);
      ctx.imports.set('refs', 'the refs(...)');
    } else {
      unread.push(use);
    }
  }
  for (const [sql, { owner, calls }] of computed) {
    const edits = computedRefEdits(sql, calls, owner, ctx);
    if (edits) {
      ctx.edits.push(...edits);
    } else {
      unread.push(...calls);
    }
  }
  for (const node of unread.sort((a, b) => a.getStart() - b.getStart())) {
    ctx.report(node, "'col' was removed; read the column off refs(Entity), which the codemod could not tell here");
  }
  return unread.length ? [] : ['col'];
}

function isComputedOption(option: ts.PropertyAssignment): boolean {
  const key = propertyKey(option.name);
  return key === 'computed' || key === 'virtual';
}

/** The entity a field's `computed` SQL is declared on: the decorated property's class, or `defineEntity`'s first argument. */
function computedOwner(option: ts.PropertyAssignment): Owner | undefined {
  const holder = ts.findAncestor(
    option,
    (node): node is ts.PropertyDeclaration | ts.CallExpression =>
      ts.isPropertyDeclaration(node) ||
      (ts.isCallExpression(node) && identifierText(node.expression) === 'defineEntity'),
  );
  if (holder && ts.isPropertyDeclaration(holder)) {
    return ownerOf(holder.parent);
  }
  const [entity] = holder?.arguments ?? [];
  return entity && ownerOf(entity);
}

/** `(product) => ` before a `computed` raw, and `product.x` for each `col('x')` in it, where every one names a member. */
function computedRefEdits(
  sql: ts.TaggedTemplateExpression,
  calls: readonly ts.CallExpression[],
  owner: Owner,
  ctx: Context,
): Edits {
  const members = memberNames(owner.entity, ctx.checker);
  const names = calls.map((call) => columnMember(call, members));
  if (mentions(sql, owner.param) || !names.every((name): name is string => name !== undefined)) {
    return undefined;
  }
  return [
    inserted(sql, `(${owner.param}) => `),
    ...calls.map((call, at) => replaced(call, memberAccess(owner.param, names[at]))),
  ];
}

/** `refs(Item).x` for a `col('x')` in a statement, where the entity its SQL renders against can be told. */
function statementRefEdit(call: ts.CallExpression, ctx: Context): Edit | undefined {
  const entity = statementEntity(call, ctx.checker);
  const name = entity && columnMember(call, propertyNames(entity.type));
  return entity && name !== undefined ? replaced(call, memberAccess(`refs(${entity.name})`, name)) : undefined;
}

/** The member a `col('x')` names, where its one argument is a literal naming one of `members`. */
function columnMember(call: ts.CallExpression, members: ReadonlySet<string>): string | undefined {
  const [name] = call.arguments;
  return call.arguments.length === 1 && ts.isStringLiteralLike(name) && members.has(name.text) ? name.text : undefined;
}

/** Whether `node` reads a binding named `name`, which a callback parameter of that name would shadow. */
function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node)) {
    return node.text === name && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node);
  }
  return ts.forEachChild(node, (child) => mentions(child, name) || undefined) ?? false;
}

type NamedEntity = { readonly name: string; readonly type: ts.Type };

/**
 * The entity a statement's SQL renders against at `node`: the one its query names, or a relation a `$populate`
 * reads there. Nothing where a function or a relation filter in between opens a scope of its own.
 */
function statementEntity(node: ts.Node, checker: ts.TypeChecker): NamedEntity | undefined {
  const path: string[] = [];
  for (let at: ts.Node = node; at.parent; at = at.parent) {
    const { parent } = at;
    if (ts.isFunctionLike(parent)) {
      return undefined;
    }
    if (ts.isPropertyAssignment(parent)) {
      path.unshift(propertyKey(parent.name) ?? '');
    }
    const queried = ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === at);
    const entity = queried ? queriedEntity(parent, checker) : undefined;
    if (entity) {
      return entityAlong(entity, path, node, checker);
    }
  }
  return undefined;
}

/** The entity a call queries: its first argument's class, or the `$entity` its query names. */
function queriedEntity(call: ts.CallExpression, checker: ts.TypeChecker): NamedEntity | undefined {
  const [first] = call.arguments;
  const entity = first && ts.isObjectLiteralExpression(first) ? propertyValue(first, '$entity') : first;
  const instance = entity && constructedType(checker.getTypeAtLocation(entity));
  return entity && ts.isIdentifier(entity) && instance ? { name: entity.text, type: instance } : undefined;
}

/** `entity` followed along `path`: into each relation a `$populate` names, and nowhere a relation filter opens. */
function entityAlong(
  entity: NamedEntity,
  path: readonly string[],
  node: ts.Node,
  checker: ts.TypeChecker,
): NamedEntity | undefined {
  let current = entity;
  for (const [at, key] of path.entries()) {
    const property = current.type.getProperty(key);
    const related = property && relatedClass(property, node, checker);
    if (!related) {
      continue;
    }
    const inScope = checker.getSymbolsInScope(node, ts.SymbolFlags.Class).some(({ name }) => name === related.name);
    if (path[at - 1] !== '$populate' || !inScope) {
      return undefined;
    }
    current = { name: related.name, type: checker.getDeclaredTypeOfSymbol(related) };
  }
  return current;
}

/** The class a relation property points at, one or many, or nothing where the property holds no class. */
function relatedClass(property: ts.Symbol, node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, node));
  const symbol = (checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type).getSymbol();
  return symbol && symbol.flags & ts.SymbolFlags.Class ? symbol : undefined;
}
