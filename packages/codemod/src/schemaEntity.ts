import ts from 'typescript';
import { chainedSchema } from './builders.js';
import { type Finding, formatFindings, locationAt } from './context.js';
import { CLASS_DEFINERS, type DefinerCall, type DefinerName, definerCall } from './definers.js';
import {
  type Edit,
  editedText,
  type Pass,
  removeStatement,
  replaced,
  replacingUses,
  reparsedAgain,
  unedited,
} from './edits.js';
import { importEdits } from './imports.js';
import { memberKey, paramFor, quoted } from './keyMaps.js';
import { nameClash } from './schemaMessages.js';
import { KEPT_OPTIONS } from './schemaOptions.js';
import {
  arrayElements,
  decoratorsOf,
  freeName,
  hasModifier,
  identifierText,
  identifierUses,
  indentOf,
  indentUnit,
  isNamedProperty,
  objectLiteral,
  objectProperties,
  propertyKey,
  propertyValue,
} from './syntax.js';

/** Imports a converted file may no longer read: the definers folded in, and the brands a schema derives. */
const FOLDED_IMPORTS: ReadonlySet<string> = new Set([
  ...Object.keys(CLASS_DEFINERS).filter((name) => name !== 'defineEntity'),
  'idKey',
  'versionKey',
  'filledKey',
]);

const RELATION_KINDS: ReadonlyMap<string, string> = new Map([
  ['11', 'oneToOne'],
  ['m1', 'manyToOne'],
  ['1m', 'oneToMany'],
  ['mm', 'manyToMany'],
]);

const READ_OPTIONS: ReadonlySet<string | undefined> = new Set([
  'name',
  'schema',
  'extends',
  'fields',
  'relations',
  'hooks',
  ...KEPT_OPTIONS,
]);

/** How each option holding entries is written for its entries to be read one by one: a map of plain properties, or a list. */
const ENTRY_OPTIONS: Readonly<Record<string, 'map' | 'list'>> = {
  fields: 'map',
  relations: 'map',
  hooks: 'map',
  filters: 'map',
  indexes: 'list',
  checks: 'list',
  triggers: 'list',
};

/** Whether `value` is written as `shape` says, so no entry hides in a variable, a spread or a shorthand. */
function readsAs(value: ts.Expression, shape: 'map' | 'list'): boolean {
  return shape === 'list'
    ? ts.isArrayLiteralExpression(value)
    : ts.isObjectLiteralExpression(value) && value.properties.every(ts.isPropertyAssignment);
}

/** What a class-form relation said that a `rel` builder says by its name and first argument. */
const RELATION_SHAPE: ReadonlySet<string | undefined> = new Set(['cardinality', 'entity']);

export type SchemaResult = Pass & { readonly unresolved: string[]; readonly notes: string[] };

/** A class registered by a call naming it, and the calls that did. */
type Registration = { readonly cls: ts.ClassDeclaration; readonly calls: DefinerCall[] };

/**
 * Declares each class `defineEntity(Class, options)` registered as the schema `defineEntity({ name, fields })` and its
 * chain of sections, folding the string-keyed definers of the same class in. Read off the text the other rewrites
 * produced, whose options already name members by callback, so it only moves what is written. An entity it cannot
 * declare faithfully, `taken` naming a builder it writes among them, is left as written and reported.
 */
export function toSchemaEntities(
  fileName: string,
  text: string,
  { locate, taken }: { readonly locate?: (at: number) => string; readonly taken: ReadonlySet<string> },
): SchemaResult {
  if (!CLASS_FORM_CALL.test(text)) {
    return { ...unedited(text), unresolved: [], notes: [] };
  }
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const located = locate ?? ((at: number) => locationAt(source, at));
  const unit = indentUnit(source);
  const unresolved: Finding[] = [];
  const notes: Finding[] = [];
  const edits: Edit[] = [];
  const written = new Set<string>();
  const registrations = collectRegistrations(source, unresolved);
  const entityCallOf = (calls: readonly DefinerCall[]) => calls.find(({ definer }) => definer === 'defineEntity')?.call;
  for (const [name, { cls, calls }] of registrations) {
    const entityCall = entityCallOf(calls);
    if (!entityCall) {
      unresolved.push(...calls.map(({ call, definer }) => ({ node: call, message: removedDefiner(definer, name) })));
      continue;
    }
    const base = baseName(entityCall);
    const baseCall = base && entityCallOf(registrations.get(base)?.calls ?? []);
    if (baseCall && baseCall.getStart() > entityCall.getStart()) {
      unresolved.push({
        node: entityCall,
        message: `'${name}' extends '${base}', declared below it: move defineEntity(${base}, ...) above this one, then run again`,
      });
      continue;
    }
    const schema = schemaOf(name, cls, calls, entityCall, unit);
    if ('message' in schema) {
      unresolved.push(schema);
      continue;
    }
    const chained = chainedSchema(schema.text);
    if (!('text' in chained)) {
      unresolved.push(
        ...chained.reasons.map((reason) => ({ node: entityCall, message: `'${name}' is left as written: ${reason}` })),
      );
      continue;
    }
    const clash = [...chained.builders].find((builder) => taken.has(builder));
    if (clash !== undefined) {
      unresolved.push({ node: entityCall, message: `'${name}' is left as written: ${nameClash(clash)}` });
      continue;
    }
    for (const builder of chained.builders) written.add(builder);
    notes.push(...schema.notes);
    edits.push(removeStatement(cls));
    for (const { call } of calls) {
      edits.push(
        call === entityCall ? replaced(call.parent, indented(chained.text, call.parent)) : removeStatement(call.parent),
      );
    }
  }
  return {
    ...(edits.length
      ? reparsedAgain(fileName, editedText(text, edits), (edited) => importEdits(edited, written, FOLDED_IMPORTS))
      : unedited(text)),
    unresolved: formatFindings(unresolved, located),
    notes: formatFindings(notes, located),
  };
}

/** The class a `defineEntity(Class, { extends })` names as its base, which its schema's const reads where it is declared. */
function baseName(entityCall: ts.CallExpression): string | undefined {
  const options = objectLiteral(entityCall.arguments[1]);
  return identifierText(options && propertyValue(options, 'extends'));
}

/** A call a class-form definer makes, its entity named first: what the pass has anything to do with. */
const CLASS_FORM_CALL = new RegExp(`\\b(?:${Object.keys(CLASS_DEFINERS).join('|')})\\(\\s*[\\w$.]+\\s*[,)]`);

/**
 * Each class the file declares that a class-form definer names, with those calls, in source order. A call naming
 * anything else, or not written as a statement of its own, is reported: there is no class here to declare.
 */
function collectRegistrations(source: ts.SourceFile, unresolved: Finding[]): Map<string, Registration> {
  const classes = new Map(
    source.statements
      .filter((statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && !!statement.name)
      .map((cls) => [cls.name!.text, cls]),
  );
  const registrations = new Map<string, Registration>();
  const visit = (node: ts.Node): void => {
    const read = ts.isCallExpression(node) ? definerCall(node) : undefined;
    if (read) {
      const name = identifierText(read.entity);
      const cls = name ? classes.get(name) : undefined;
      if (name && cls && ts.isExpressionStatement(node.parent) && node.parent.parent === source) {
        const registration = registrations.get(name) ?? { cls, calls: [] };
        registration.calls.push(read);
        registrations.set(name, registration);
      } else if (read.definer === 'defineEntity') {
        unresolved.push({ node, message: 'defineEntity takes a schema now: defineEntity({ name, fields, ... })' });
      } else {
        unresolved.push({ node, message: removedDefiner(read.definer, textOf(read.entity)) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return registrations;
}

/** Why an incremental definer naming `entity` has nowhere to fold into. */
function removedDefiner(definer: DefinerName, entity: string): string {
  return `${definer} was removed: register '${entity}' with defineEntity in this file, or decorate it (${CLASS_DEFINERS[definer]})`;
}

/** The schema a class's registrations declare, and what about it is worth a second look. */
type Schema = { readonly text: string; readonly notes: Finding[] };

/** The options of the class's registrations gathered by kind, each entry as written. */
type Gathered = {
  fields: string[];
  /** Whether a field took its column type from the class's declaration, so `fields` is no longer as written. */
  typed: boolean;
  computed: string[];
  aggregates: string[];
  relations: Map<string, string>;
  hooks: Map<string, string[]>;
  kept: Map<KeptOption, string[]>;
};

type KeptOption = (typeof KEPT_OPTIONS)[number];

function schemaOf(
  name: string,
  cls: ts.ClassDeclaration,
  calls: readonly DefinerCall[],
  entityCall: ts.CallExpression,
  unit: string,
): Schema | Finding {
  const refused = (message: string): Finding => ({ node: entityCall, message });
  const options = objectLiteral(entityCall.arguments[1]) ?? (entityCall.arguments[1] ? undefined : emptyOptions());
  if (!options || options.properties.some((prop) => !ts.isPropertyAssignment(prop))) {
    return refused("defineEntity's options could not be read: write them as an object literal");
  }
  if (cls.heritageClauses?.length) {
    return refused(`'${name}' extends a class: declare the base with defineEntity too and pass it as 'extends'`);
  }
  if (decoratorsOf(cls).length) {
    return refused(`'${name}' is decorated as well: declare it one way, decorators or a schema`);
  }
  const exported = hasModifier(cls, ts.SyntaxKind.ExportKeyword);
  if (hasModifier(cls, ts.SyntaxKind.DefaultKeyword)) {
    return refused(`'${name}' is a default export: export the schema's const by name instead`);
  }
  const unread = objectProperties(options).find(({ name: key }) => !READ_OPTIONS.has(propertyKey(key)));
  if (unread) {
    return refused(`'${textOf(unread.name)}' has no place in a schema: move it by hand`);
  }
  for (const [option, shape] of Object.entries(ENTRY_OPTIONS)) {
    const value = propertyValue(options, option);
    if (value && !readsAs(value, shape)) {
      const literal = shape === 'map' ? 'an object literal of its entries' : 'an array literal';
      return { node: value, message: `'${option}' could not be read: write it as ${literal}` };
    }
  }

  const scope: Scope = {
    name,
    param: paramFor(name),
    rel: freeName(
      'rel',
      calls.map(({ call }) => call),
    ),
    self: freeName(paramFor(name), outerReads(paramFor(name), options, calls)),
    declared: declaredTypes(cls),
    relations: new Set([
      ...objectProperties(propertyValue(options, 'relations')).map((it) => propertyKey(it.name)),
      ...calls.filter((read) => read.definer === 'defineRelation').map((read) => read.key),
    ]),
    methods: new Map(
      cls.members
        .filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member))
        .map((method) => [textOf(method.name), method]),
    ),
    hooked: new Map(),
  };
  const gathered: Gathered = {
    fields: [],
    typed: false,
    computed: [],
    aggregates: [],
    relations: new Map(),
    hooks: new Map(),
    kept: new Map(),
  };
  const { hooked } = scope;
  const notes: Finding[] = [];
  for (const read of calls) {
    const problem = gather(read, read.call === entityCall ? options : undefined, gathered, scope);
    if (problem) {
      return problem;
    }
  }
  const member = cls.members.find(
    (it) =>
      !(ts.isPropertyDeclaration(it) && !hasModifier(it, ts.SyntaxKind.StaticKeyword)) &&
      !(ts.isMethodDeclaration(it) && hooked.has(textOf(it.name))),
  );
  if (member) {
    const what = ts.isMethodDeclaration(member) ? 'method' : 'member';
    const label = member.name ? textOf(member.name) : textOf(member).split('\n')[0];
    return refused(
      `'${name}' has the ${what} '${label}': rows are plain objects, so make it a function of the row, then run again`,
    );
  }
  for (const [method, declaration] of hooked) {
    notes.push({
      node: declaration,
      message: `'${method}' runs as a hook of the row now, no longer a method of '${name}': call sites need the function`,
    });
  }
  notes.push(...looserTypes(cls, options));

  const table = propertyValue(options, 'name');
  const lines = [`name: ${quoted(name)}`, ...(table ? [`table: ${textOf(table)}`] : [])];
  for (const key of ['schema', 'extends']) {
    const value = propertyValue(options, key);
    if (value) {
      lines.push(`${key}: ${textOf(value)}`);
    }
  }
  const fieldsValue = propertyValue(options, 'fields');
  const untouched =
    fieldsValue &&
    gathered.fields.length === objectProperties(fieldsValue).length &&
    !gathered.typed &&
    !gathered.computed.length &&
    !gathered.aggregates.length;
  lines.push(`fields: ${untouched ? textOf(fieldsValue) : block(gathered.fields, unit)}`);
  if (gathered.computed.length) {
    lines.push(`computed: ${block(gathered.computed, unit)}`);
  }
  if (gathered.relations.size) {
    lines.push(`relations: (${scope.rel}) => (${block([...gathered.relations.values()], unit)})`);
  }
  if (gathered.aggregates.length) {
    lines.push(`aggregates: (${scope.self}) => (${block(gathered.aggregates, unit)})`);
  }
  for (const key of KEPT_OPTIONS) {
    const entries = gathered.kept.get(key);
    if (entries) {
      lines.push(`${key}: ${keptValue(key, entries, propertyValue(options, key))}`);
    }
  }
  if (gathered.hooks.size) {
    lines.push(
      `hooks: ${block(
        [...gathered.hooks].map(([event, runs]) => `${event}: [${runs.join(', ')}]`),
        unit,
      )}`,
    );
  }
  const prefix = exported ? 'export ' : '';
  return {
    text: `${prefix}const ${name} = defineEntity({\n${lines.map((line) => `${unit}${line},`).join('\n')}\n});\n${prefix}type ${name} = InstanceType<typeof ${name}>;`,
    notes,
  };
}

const emptyOptions = (): ts.ObjectLiteralExpression => ts.factory.createObjectLiteralExpression();

/** Entries as an object literal a level in: `{\n    a,\n  }`. */
function block(entries: readonly string[], unit: string): string {
  return entries.length ? `{\n${entries.map((entry) => `${unit}${unit}${entry},\n`).join('')}${unit}}` : '{}';
}

/** `node`'s text, its lines after the first indented relative to the statement holding it. */
function textOf(node: ts.Node): string {
  return rebased(node.getText(), node);
}

/** `text`, written inside `node`, with the indentation of the statement holding it taken off its lines. */
function rebased(text: string, node: ts.Node): string {
  return text.replaceAll(`\n${indentOf(statementOf(node))}`, '\n');
}

function statementOf(node: ts.Node): ts.Node {
  return ts.isSourceFile(node.parent) ? node : statementOf(node.parent);
}

/** `text` replacing `node`, each line after its first indented as `node` is. */
function indented(text: string, node: ts.Node): string {
  return text.replaceAll('\n', `\n${indentOf(node)}`);
}

/** A kept option's value: as written where nothing was folded into it, its entries joined otherwise. */
function keptValue(key: KeptOption, entries: readonly string[], written: ts.Expression | undefined): string {
  if (written && entries.length === entriesOfValue(key, written).length) {
    return textOf(written);
  }
  return ENTRY_OPTIONS[key] === 'map' ? `{ ${entries.join(', ')} }` : `[${entries.join(', ')}]`;
}

/** The entries of a kept option as written: a map's properties, a list's elements. */
function entriesOfValue(key: KeptOption, value: ts.Expression): readonly ts.Node[] {
  return ENTRY_OPTIONS[key] === 'map' ? objectProperties(value) : arrayElements(value);
}

/**
 * Adds what one registration declares to `gathered`: `options` for the `defineEntity` call, its arguments for an
 * incremental definer. Returns why it cannot, where it cannot.
 */
function gather(
  { call, definer, key, options: third, rest }: DefinerCall,
  options: ts.ObjectLiteralExpression | undefined,
  gathered: Gathered,
  { name, param, rel, self, relations, methods, hooked, declared }: Scope,
): Finding | undefined {
  const unreadable = {
    node: call,
    message: `${definer}'s arguments could not be read: fold them into defineEntity by hand`,
  };
  const addHook = (event: string, method: string): Finding | undefined => {
    const declaration = methods.get(method);
    if (!declaration) {
      return { node: call, message: `the hook '${method}' names no method of the class` };
    }
    const run = hookFunction(declaration, param);
    if (!run) {
      return {
        node: declaration,
        message: `'${method}' takes more than the hook context: make it a function of the row by hand`,
      };
    }
    hooked.set(method, declaration);
    const runs = gathered.hooks.get(event) ?? [];
    runs.push(run);
    gathered.hooks.set(event, runs);
    return undefined;
  };
  const addField = (
    key: string | undefined,
    label: string,
    value: string,
    fieldOptions: ts.Expression,
    node: ts.Node,
  ) => {
    const aggregate = key && aggregateEntry(`${name}.${key}`, key, fieldOptions, relations, self);
    if (typeof aggregate === 'string') {
      gathered.aggregates.push(aggregate);
      return undefined;
    }
    if (aggregate) {
      return { node, message: aggregate.message };
    }
    const type = key === undefined ? undefined : untyped(fieldOptions) && declared.get(key);
    gathered.typed ||= !!type;
    const entry = `${label}: ${type ? withOption(value, `type: ${type}`) : value}`;
    (isComputed(fieldOptions) ? gathered.computed : gathered.fields).push(entry);
    return undefined;
  };
  const addRelation = (key: string | undefined, value: ts.Expression): boolean => {
    const built = key && relationEntry(key, value, rel);
    if (built) {
      gathered.relations.set(key, built);
    }
    return !!built;
  };
  const addKept = (option: KeptOption, entries: readonly string[]) => {
    const kept = gathered.kept.get(option) ?? [];
    kept.push(...entries);
    gathered.kept.set(option, kept);
  };

  if (options) {
    for (const field of objectProperties(propertyValue(options, 'fields'))) {
      const problem = addField(
        propertyKey(field.name),
        textOf(field.name),
        textOf(field.initializer),
        field.initializer,
        field,
      );
      if (problem) return problem;
    }
    for (const relation of objectProperties(propertyValue(options, 'relations'))) {
      if (!addRelation(propertyKey(relation.name), relation.initializer)) {
        return {
          node: relation,
          message: 'a relation could not be read: write it as rel.<kind>(Target, { ... }) by hand',
        };
      }
    }
    for (const hook of objectProperties(propertyValue(options, 'hooks'))) {
      const listed = hookMethods(hook.initializer);
      if (!listed) {
        return { node: hook, message: 'a hook list could not be read: write its functions by hand' };
      }
      for (const method of listed) {
        const problem = addHook(textOf(hook.name), method);
        if (problem) return problem;
      }
    }
    for (const option of KEPT_OPTIONS) {
      const value = propertyValue(options, option);
      if (value) {
        addKept(
          option,
          entriesOfValue(option, value).map((it) => textOf(it)),
        );
      }
    }
    return undefined;
  }
  switch (definer) {
    case 'defineEntity':
      return unreadable;
    case 'defineField':
    case 'defineId': {
      if (!key || !third) return unreadable;
      const literal = objectLiteral(third);
      const value = definer === 'defineId' ? literal && withOption(textOf(literal), 'isId: true') : textOf(third);
      if (!value) return unreadable;
      return addField(key, memberKey(key), value, third, call);
    }
    case 'defineRelation':
      return third && addRelation(key, third) ? undefined : unreadable;
    case 'defineHook': {
      const event = third && ts.isStringLiteralLike(third) ? third.text : undefined;
      return key && event ? addHook(event, key) : unreadable;
    }
    case 'defineIndex':
      if (!third) return unreadable;
      addKept('indexes', [textOf(third)]);
      return undefined;
    case 'defineTrigger':
      if (!rest.length) return unreadable;
      addKept(
        'triggers',
        rest.map((it) => textOf(it)),
      );
      return undefined;
    case 'defineFilter':
      if (!key || !third) return unreadable;
      addKept('filters', [`${memberKey(key)}: ${textOf(third)}`]);
      return undefined;
  }
}

/** Whether a field's options compute it, which a schema declares under `computed`. */
function isComputed(options: ts.Expression): boolean {
  const literal = objectLiteral(options);
  return !!literal && propertyValue(literal, 'computed') !== undefined;
}

/**
 * The bodies of the field callbacks whose parameter is not `name`, where a `name` they read is the file's: a
 * callback taking `name` reads its own under it, which the aggregate it becomes reads under the same name.
 */
function outerReads(name: string, options: ts.ObjectLiteralExpression, calls: readonly DefinerCall[]): ts.Node[] {
  const declared = [
    ...objectProperties(propertyValue(options, 'fields')).map((field) => field.initializer),
    ...calls.flatMap(({ options: third }) => (third ? [third] : [])),
  ];
  return declared.flatMap((field) => {
    const literal = objectLiteral(field);
    const computed = literal && propertyValue(literal, 'computed');
    return computed && ts.isArrowFunction(computed) && identifierText(computed.parameters[0]?.name) !== name
      ? [computed.body]
      : [];
  });
}

/** An options literal's text with `option` written first: `{ isId: true, type: String }`. */
function withOption(literal: string, option: string): string {
  return /^\{\s*\}$/.test(literal) ? `{ ${option} }` : literal.replace(/^\{\s*/, `{ ${option}, `);
}

/** Whether a field's options are a literal stating no column type, which the class's declaration may say instead. */
function untyped(options: ts.Expression): boolean {
  const literal = objectLiteral(options);
  return !!literal && ['type', 'enum', 'version'].every((option) => propertyValue(literal, option) === undefined);
}

/** The constructors the TypeScript types of a class's properties name: `number | null` is `Number`. */
const DECLARED_TYPES: Readonly<Record<string, string>> = {
  number: 'Number',
  string: 'String',
  boolean: 'Boolean',
  bigint: 'BigInt',
  Date: 'Date',
};

/** Each property a class declares as one of {@link DECLARED_TYPES}, with that type's constructor. */
function declaredTypes(cls: ts.ClassDeclaration): ReadonlyMap<string, string> {
  return new Map(
    cls.members.filter(ts.isPropertyDeclaration).flatMap((member) => {
      const key = propertyKey(member.name);
      const type = member.type;
      const arms = type && ts.isUnionTypeNode(type) ? type.types : type ? [type] : [];
      const named = arms.map((arm) => arm.getText()).filter((arm) => arm !== 'null' && arm !== 'undefined');
      const constructor = named.length === 1 ? DECLARED_TYPES[named[0]] : undefined;
      return key && constructor ? [[key, constructor] as const] : [];
    }),
  );
}

/** `author: () => rel.manyToOne(User, { references })` from `{ cardinality: 'm1', entity: () => User, references }`. */
function relationEntry(key: string, value: ts.Expression, rel: string): string | undefined {
  const relation = objectLiteral(value);
  const cardinality = relation && propertyValue(relation, 'cardinality');
  const getter = relation && propertyValue(relation, 'entity');
  const kind = cardinality && ts.isStringLiteralLike(cardinality) ? RELATION_KINDS.get(cardinality.text) : undefined;
  if (!relation || !kind || !getter || !ts.isArrowFunction(getter) || ts.isBlock(getter.body)) {
    return undefined;
  }
  const properties = relation.properties.filter(isNamedProperty);
  if (properties.length !== relation.properties.length) {
    return undefined;
  }
  const rest = properties.filter((prop) => !RELATION_SHAPE.has(propertyKey(prop.name))).map((prop) => textOf(prop));
  const args = [textOf(getter.body), ...(rest.length ? [`{ ${rest.join(', ')} }`] : [])];
  return `${memberKey(key)}: () => ${rel}.${kind}(${args.join(', ')})`;
}

/** The methods a hook list names, `(post) => [post.stamp]`, or nothing where it is not one. */
function hookMethods(list: ts.Expression): string[] | undefined {
  if (!ts.isArrowFunction(list) || !ts.isArrayLiteralExpression(list.body) || list.parameters.length !== 1) {
    return undefined;
  }
  const param = identifierText(list.parameters[0].name);
  const names = list.body.elements.map((entry) =>
    ts.isPropertyAccessExpression(entry) && identifierText(entry.expression) === param ? entry.name.text : undefined,
  );
  return names.every((it) => it !== undefined) ? names : undefined;
}

/** A hook method as a function of the row: `this` read as the row, named `preferred` where the body leaves it free. */
function hookFunction(method: ts.MethodDeclaration, preferred: string): string | undefined {
  if (!method.body || method.parameters.length > 1) {
    return undefined;
  }
  const row = freeName(preferred, [method]);
  const isAsync = hasModifier(method, ts.SyntaxKind.AsyncKeyword);
  const params = [row, ...method.parameters.map((it) => textOf(it))].join(', ');
  const body = method.body;
  const uses: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      uses.push(node);
    } else if (!ts.isFunctionLike(node) || ts.isArrowFunction(node)) {
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(body, visit);
  return `${isAsync ? 'async ' : ''}(${params}) => ${substituted(body, uses, row)}`;
}

/** What a class's registrations are read against: the entity, the parameter its callbacks take, its relations and methods. */
type Scope = {
  readonly name: string;
  readonly param: string;
  /** The schema's `relations` parameter, `rel` unless their code reads that name already. */
  readonly rel: string;
  /** The parameter its aggregates read the entity's relations off, named after the entity likewise. */
  readonly self: string;
  /** The column type each property's TypeScript type states, for a field whose options state none. */
  readonly declared: ReadonlyMap<string, string>;
  readonly relations: ReadonlySet<string | undefined>;
  readonly methods: ReadonlyMap<string, ts.MethodDeclaration>;
  readonly hooked: Map<string, ts.MethodDeclaration>;
};

/**
 * `total: () => rel.items.count()` from a field computed over a relation, `{ computed: (counted) => counted.items.count() }`,
 * which a schema declares among its aggregates; nothing for a field reading no relation, and why where it cannot move.
 */
function aggregateEntry(
  label: string,
  key: string,
  options: ts.Expression,
  relations: ReadonlySet<string | undefined>,
  rel: string,
): string | { readonly message: string } | undefined {
  const literal = objectLiteral(options);
  const computed = literal && propertyValue(literal, 'computed');
  const param = computed && ts.isArrowFunction(computed) ? identifierText(computed.parameters[0]?.name) : undefined;
  if (!computed || !ts.isArrowFunction(computed) || !param) {
    return undefined;
  }
  const uses = identifierUses(computed.body, param);
  const overRelation = (use: ts.Identifier) =>
    ts.isPropertyAccessExpression(use.parent) && use.parent.expression === use && relations.has(use.parent.name.text);
  if (!uses.some(overRelation)) {
    return undefined;
  }
  if (literal.properties.length > 1) {
    return { message: `'${label}' aggregates a relation with options an aggregate takes none of: move it by hand` };
  }
  if (ts.isBlock(computed.body) || !uses.every(overRelation)) {
    return { message: `'${label}' reads more than a relation's aggregate: move it by hand` };
  }
  return `${memberKey(key)}: () => ${substituted(computed.body, uses, rel)}`;
}

/** `body`'s text, rebased, with each of `uses` written as `replacement`. */
function substituted(body: ts.Node, uses: readonly ts.Node[], replacement: string): string {
  return rebased(replacingUses(body, uses, replacement), body);
}

/** Notes each property the class typed more narrowly than its schema derives, with the option that keeps it. */
function looserTypes(cls: ts.ClassDeclaration, options: ts.ObjectLiteralExpression): Finding[] {
  const fields = objectLiteral(propertyValue(options, 'fields'));
  return cls.members.flatMap((member): Finding[] => {
    const key = ts.isPropertyDeclaration(member) ? propertyKey(member.name) : undefined;
    const declared = ts.isPropertyDeclaration(member) ? member.type : undefined;
    const field = key && fields ? objectLiteral(propertyValue(fields, key)) : undefined;
    if (!key || !declared || !field) {
      return [];
    }
    const written = textOf(declared);
    const said = (option: string) => propertyValue(field, option) !== undefined;
    if (/\bJson</.test(written) && !said('schema')) {
      return [
        {
          node: member,
          message: `'${key}' was declared ${written}: describe its payload with a Standard Schema, 'f.json(schema)', to keep it typed`,
        },
      ];
    }
    const literals =
      ts.isUnionTypeNode(declared) &&
      declared.types.filter((type) => ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal));
    if (literals && literals.length > 1 && !said('enum')) {
      return [
        { node: member, message: `'${key}' was declared ${written}: list its values in 'enum' to keep them typed` },
      ];
    }
    return [];
  });
}
