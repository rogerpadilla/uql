import ts from 'typescript';
import { call, flag, flagOrCall, type OptionMethod } from './columnMethods.js';
import { type Finding, formatFindings, locationAt } from './context.js';
import {
  applyEdits,
  type Edit,
  editedText,
  inserted,
  type Pass,
  replaced,
  replacingUses,
  reparsedAgain,
  unedited,
} from './edits.js';
import { deadImports, importRemovalEdits, importText, spelledNames, uqlImportDeclarations } from './imports.js';
import { isCallback, paramFor } from './keyMaps.js';
import { CHAINED_OPTIONS, FIRST_CALL_OPTIONS } from './schemaOptions.js';
import {
  type ChainMethod,
  chainOf,
  decoratorName,
  decoratorsOf,
  FIELD_DECORATORS,
  identifierText,
  identifierUses,
  indentOf,
  indentUnit,
  keyOf,
  objectLiteral,
  optionsOf,
  propertiesByKey,
  propertyAssignment,
  propertyValue,
} from './syntax.js';

export type BuildersResult = Pass & { readonly unresolved: string[] };

/** The column type each constructor implies, and the builder it is now. */
const CONSTRUCTORS: Readonly<Record<string, string>> = {
  String: 'f.string()',
  Number: 'f.number()',
  BigInt: 'f.bigint()',
  Boolean: 'f.boolean()',
  Date: 'f.date()',
};

/** The column types a builder of their own names. */
const NAMED_TYPES: Readonly<Record<string, string>> = { text: 'f.text()', uuid: 'f.uuid()' };

/** The method a `false` states and a `true` says already, nothing; a value no literal states is `undefined`. */
const onlyFalse =
  (method: string) =>
  (value: string): string | undefined =>
    value === 'false' ? `.${method}(false)` : value === 'true' ? '' : undefined;

/** Each option a method writes, in the order a builder chains them, with how its value becomes a call. */
const METHODS: readonly OptionMethod<string | undefined>[] = [
  ['defaultValue', call('default')],
  ['onInsert', call('onInsert')],
  ['onUpdate', call('onUpdate')],
  ['updatable', onlyFalse('updatable')],
  ['eager', onlyFalse('eager')],
  ['softDelete', flagOrCall('softDelete')],
  ['unique', flag('unique')],
  ['index', (value) => (value === 'true' ? '.index()' : call('index')(value))],
  ['autoIncrement', (value) => (value === 'true' ? '.autoIncrement()' : call('autoIncrement')(value))],
  ['length', call('length')],
  ['precision', call('precision')],
  ['scale', call('scale')],
  ['dimensions', call('dimensions')],
  ['distance', call('distance')],
  ['columnType', call('columnType')],
  ['name', call('name')],
  ['comment', call('comment')],
  ['references', call('references')],
  ['onDelete', call('onDelete')],
];

/** What a constructor or `nullable()`/`id()` already said, so no method repeats it. */
const SAID_BY_SHAPE = new Set(['type', 'nullable', 'isId', 'enum', 'shape', 'version', 'computed', 'stored']);

const KNOWN = new Set([...SAID_BY_SHAPE, ...METHODS.map(([option]) => option)]);

/** The options a literal states, each by its key, or why it cannot be read. */
function optionsByKey(node: ts.Expression): Map<string, ts.Expression> | string {
  const options = optionsOf(node);
  if (options.kind === 'opaque') {
    return options.reason;
  }
  return propertiesByKey(options.node) ?? 'its options name one by a computed key';
}

/** `value` without an `as const`, which a builder's `const` type parameter makes redundant. */
function withoutAsConst(value: ts.Expression): string {
  return ts.isAsExpression(value) && value.type.getText() === 'const' ? value.expression.getText() : value.getText();
}

/** The builder a column's options describe, `f.string().nullable()`, or why it cannot be written. */
function columnBuilder(options: Map<string, ts.Expression>, key: boolean): string | { readonly message: string } {
  const unknown = [...options.keys()].filter((option) => !KNOWN.has(option));
  if (unknown.length) {
    return { message: `has options no builder writes: ${unknown.join(', ')}` };
  }
  const consumed = new Set<string>();
  const text = (option: string) => {
    const value = options.get(option);
    if (value) consumed.add(option);
    return value && withoutAsConst(value);
  };
  const constructor = constructorOf(options, text);
  if (typeof constructor !== 'string') {
    return constructor;
  }
  const nullable = text('nullable');
  if (nullable !== undefined && nullable !== 'true' && nullable !== 'false') {
    return { message: `has 'nullable: ${nullable}', which no builder states unless it is a literal` };
  }
  const isKey = key || text('isId') === 'true';
  const present = nullable === 'false' || isKey || options.has('version');
  const shape = isKey ? '.id()' : present ? '' : '.nullable()';
  const methods: string[] = [];
  for (const [option, method] of METHODS) {
    const value = consumed.has(option) ? undefined : text(option);
    if (value === undefined) continue;
    const written = method(value);
    if (written === undefined) {
      return { message: `has '${option}: ${value}', which no builder method states unless it is a literal` };
    }
    methods.push(written);
  }
  return `${constructor}${shape}${methods.join('')}`;
}

/** `f.decimal()` with the precision and scale its options state. */
function decimalOf(text: (option: string) => string | undefined): string {
  return `f.decimal(${[text('precision'), text('scale')].filter(Boolean).join(', ')})`;
}

/** The builder a column starts from, its `type` read with whatever the constructor itself takes. */
function constructorOf(
  options: Map<string, ts.Expression>,
  text: (option: string) => string | undefined,
): string | { readonly message: string } {
  const type = text('type');
  const members = text('enum');
  if (options.has('shape') && type !== "'json'" && type !== "'jsonb'") {
    return { message: "has a 'shape' on a column that is no JSON: only a JSON column holds a payload" };
  }
  if (options.has('version')) {
    text('version');
    if (type === undefined || type === 'Number') return 'f.version()';
    return type === 'BigInt' ? 'f.version(BigInt)' : { message: `is a version of type ${type}: use f.version()` };
  }
  if (members !== undefined) {
    return type === 'String' || type === 'Number' || type === undefined
      ? `f.enum(${members})`
      : { message: `has an enum on a '${type}' column: declare it f.enum([...]).columnType(${type})` };
  }
  if (type === undefined) {
    const references = text('references');
    return references ? `f.references(${references})` : { message: "has no 'type': state it, f.string() and so on" };
  }
  const columnType = options.get('columnType')?.getText();
  if (type === 'String' && (columnType === "'decimal'" || columnType === "'numeric'")) {
    text('columnType');
    return columnType === "'decimal'" ? decimalOf(text) : `f.column('numeric')`;
  }
  if (CONSTRUCTORS[type]) {
    return CONSTRUCTORS[type];
  }
  const literal = /^'(.+)'$/.exec(type)?.[1];
  if (!literal) {
    return { message: `has a type written as '${type}': write its builder, f.string() and so on` };
  }
  if (NAMED_TYPES[literal]) {
    return NAMED_TYPES[literal];
  }
  if (literal === 'json' || literal === 'jsonb') {
    const shape = text('shape');
    return `f.${literal}(${shape ?? ''})`;
  }
  if (literal === 'vector') {
    const dimensions = text('dimensions');
    return dimensions ? `f.vector(${dimensions})` : `f.column('vector')`;
  }
  if (literal === 'decimal') {
    return decimalOf(text);
  }
  return `f.column('${literal}')`;
}

/** A computed field's builder: the column it reads as, then the SQL, kept where `stored` says so. */
function computedBuilder(
  options: Map<string, ts.Expression>,
  expression: string,
): string | { readonly message: string } {
  const stored = options.get('stored')?.getText();
  const column = new Map([...options].filter(([option]) => option !== 'computed' && option !== 'stored'));
  const built = columnBuilder(column, false);
  if (typeof built !== 'string') {
    return built;
  }
  const keep = stored === undefined || stored === 'false' ? '' : stored === 'true' ? '.stored()' : `.stored(${stored})`;
  return `${built}.as(${expression})${keep}`;
}

/** `(post) => sql`...``'s body, its parameter renamed `param`; the expression itself where it is no callback. */
function bodyAs(value: ts.Expression, param: string): string | undefined {
  if (!isCallback(value)) {
    return value.getText();
  }
  const [first, ...rest] = value.parameters;
  const body = value.body;
  if (rest.length || ts.isBlock(body)) {
    return undefined;
  }
  const name = first && identifierText(first.name);
  if (!name || name === param) {
    return parenthesized(body);
  }
  return parenthesized(body, identifierUses(body, name), param);
}

/** The text of `body`, each of `uses` written `replacement`, unwrapped of the parentheses an object body needs. */
function parenthesized(body: ts.Node, uses: readonly ts.Node[] = [], replacement = ''): string {
  const inner = ts.isParenthesizedExpression(body) ? body.expression : body;
  return replacingUses(inner, uses, replacement);
}

/** `@Field({...})` and `@Id({...})` as builders, a computed one as `@Computed`. */
function decoratorEdits(property: ts.PropertyDeclaration, findings: Finding[], used: Set<string>): Edit[] {
  return decoratorsOf(property).flatMap((decorator): Edit[] => {
    const name = decoratorName(decorator);
    if ((name !== 'Field' && name !== 'Id') || !ts.isCallExpression(decorator.expression)) {
      return [];
    }
    const [argument] = decorator.expression.arguments;
    if (!argument && name === 'Id') {
      used.add('f');
      return [replaced(decorator.expression, 'Field(f.number().id())')];
    }
    if (!argument || isBuilder(argument)) {
      return [];
    }
    const options = optionsByKey(argument);
    if (typeof options === 'string') {
      findings.push({ node: decorator, message: `cannot write a builder because ${options}` });
      return [];
    }
    const computed = options.get('computed');
    if (computed) {
      return computedDecorator(decorator.expression, options, computed, findings, used);
    }
    const built = columnBuilder(options, name === 'Id');
    if (typeof built !== 'string') {
      findings.push({ node: decorator, message: built.message });
      return [];
    }
    used.add('f');
    return [replaced(decorator.expression, `Field(${built})`)];
  });
}

/** `@Computed((row) => ...)`: an aggregate as it is, SQL as the column it reads as. */
function computedDecorator(
  call: ts.CallExpression,
  options: Map<string, ts.Expression>,
  computed: ts.Expression,
  findings: Finding[],
  used: Set<string>,
): Edit[] {
  used.add('Computed');
  if (!options.has('type') && !options.has('references')) {
    return [replaced(call, `Computed(${computed.getText()})`)];
  }
  const param = (ts.isArrowFunction(computed) && identifierText(computed.parameters[0]?.name)) || 'row';
  const expression = bodyAs(computed, param);
  if (expression === undefined) {
    findings.push({ node: call, message: 'cannot inline a computed callback with a block body' });
    return [];
  }
  const built = computedBuilder(options, expression);
  if (typeof built !== 'string') {
    findings.push({ node: call, message: built.message });
    return [];
  }
  used.add('f');
  return [replaced(call, `Computed((${param}) => ${built})`)];
}

/** Whether `node` is already a builder, `f.string()...`. */
export function isBuilder(node: ts.Expression): boolean {
  return identifierText(chainOf(node).root) === 'f';
}

/** The options a schema's first call keeps. */
const FIRST_CALL: ReadonlySet<string | undefined> = new Set(FIRST_CALL_OPTIONS);
/** Every key a schema's `defineEntity` options may state, as its first call or as a section. */
const SCHEMA_KEYS: ReadonlySet<string | undefined> = new Set([
  ...FIRST_CALL,
  ...CHAINED_OPTIONS,
  'relations',
  'aggregates',
]);

/** `defineEntity({ fields: {...}, relations, ... })` as its first call and a chain of sections. */
function schemaEdits(call: ts.CallExpression, findings: Finding[], used: Set<string>): Edit[] {
  const options = objectLiteral(call.arguments[0]);
  const fields = options && objectLiteral(propertyValue(options, 'fields'));
  const chained = options?.properties.some((prop) => !FIRST_CALL.has(keyOf(prop)));
  if (!options || !fields || (!chained && fields.properties.every((prop) => isSchemaColumn(prop)))) {
    return [];
  }
  const param = schemaParam(call);
  const unknown = options.properties.filter((prop) => !SCHEMA_KEYS.has(keyOf(prop)));
  if (unknown.length) {
    findings.push({
      node: call,
      message: `cannot write a chain: it states ${unknown.map((it) => it.getText()).join(', ')}`,
    });
    return [];
  }
  const references: string[] = [];
  const field = propertyAssignment(options, 'fields');
  const columns = fields.properties.map((prop) => {
    if (!ts.isPropertyAssignment(prop)) {
      findings.push({ node: prop, message: `cannot write '${prop.getText()}' as a column: write its options inline` });
      return undefined;
    }
    const key = prop.name.getText();
    const built = isBuilder(prop.initializer)
      ? builtSchemaColumn(prop.initializer, key, references)
      : schemaColumnOf(prop.initializer, key, references);
    if (typeof built !== 'string') {
      findings.push({ node: prop, message: `'${key}' ${built.message}` });
      return undefined;
    }
    return withValue(prop, built);
  });
  const sections = CHAINED_OPTIONS.flatMap((section) => {
    const value = propertyValue(options, section);
    return value ? [chainedSection(section, value, param, findings)] : [];
  });
  if (references.length) {
    sections.push(`.references({ ${references.join(', ')} })`);
  }
  const relations = propertyValue(options, 'relations');
  const aggregates = propertyValue(options, 'aggregates');
  if (relations || aggregates) {
    sections.push(
      `.relations(${relations?.getText() ?? '() => ({})'}${aggregates ? `, ${aggregates.getText()}` : ''})`,
    );
  }
  const written = columns.filter((it) => it !== undefined);
  if (written.length !== columns.length || sections.some((it) => it === undefined)) {
    return [];
  }
  used.add('f');
  const kept = options.properties
    .filter((prop) => FIRST_CALL.has(keyOf(prop)))
    .map((prop) => (prop === field ? withValue(field, literal(fields, written)) : prop.getFullText()));
  const indent = indentOf(call);
  return [
    replaced(
      call,
      `${call.expression.getText()}(${literal(options, kept)})${sections.map((it) => `\n${indent}  ${it}`).join('')}`,
    ),
  ];
}

/** The parameter a schema's callbacks are named after: its `name` where that is a literal, else its variable's. */
function schemaParam(call: ts.CallExpression): string {
  const options = objectLiteral(call.arguments[0]);
  const name = options && /^'(.+)'$/.exec(propertyValue(options, 'name')?.getText() ?? '')?.[1];
  return paramFor(name ?? identifierText(variableOf(call)));
}

/** A schema column written as options, through {@link schemaColumn}, or why it cannot be. */
function schemaColumnOf(node: ts.Expression, key: string, references: string[]): string | { readonly message: string } {
  const column = optionsByKey(node);
  return typeof column === 'string'
    ? { message: `cannot be written as a builder because ${column}` }
    : schemaColumn(column, key, references);
}

/**
 * A schema column's builder, its foreign key moved into `.references()`, where its target is read once every entity
 * exists: written in `fields`, it would read the target while that target's own type is still being inferred.
 */
function schemaColumn(
  options: Map<string, ts.Expression>,
  key: string,
  references: string[],
): string | { readonly message: string } {
  const target = options.get('references');
  if (!target) {
    return columnBuilder(options, false);
  }
  if (!options.has('type')) {
    return { message: "references another entity but states no 'type': state the column's, as its key's" };
  }
  references.push(referenceEntry(key, target.getText(), options.get('onDelete')?.getText()));
  return columnBuilder(
    new Map([...options].filter(([option]) => option !== 'references' && option !== 'onDelete')),
    false,
  );
}

/** One entry of `.references()`: the target's getter, with its `onDelete` where one is stated. */
function referenceEntry(key: string, getter: string | undefined, action: string | undefined): string {
  return action ? `${key}: { entity: ${getter}, onDelete: ${action} }` : `${key}: ${getter}`;
}

/** Whether a schema column is a builder naming no foreign key, which a schema's `fields` keep as they are. */
function isSchemaColumn(prop: ts.ObjectLiteralElementLike): boolean {
  return (
    ts.isPropertyAssignment(prop) && isBuilder(prop.initializer) && !chainMethods(prop.initializer).has('references')
  );
}

/** Each method a builder chain calls, by name. */
function chainMethods(node: ts.Expression): ReadonlyMap<string, ChainMethod> {
  return new Map(chainOf(node).methods.map((method) => [method.name, method] as const));
}

/** A builder in `fields` with its foreign key, `.references(() => X)` and `.onDelete()`, moved into `.references()`. */
function builtSchemaColumn(
  node: ts.Expression,
  key: string,
  references: string[],
): string | { readonly message: string } {
  const methods = chainMethods(node);
  const target = methods.get('references');
  if (!target) {
    return node.getText();
  }
  if (identifierText(target.receiver) === 'f') {
    return { message: "references another entity but states no type: write its builder, as its key's" };
  }
  const onDelete = methods.get('onDelete');
  references.push(referenceEntry(key, target.call.arguments[0]?.getText(), onDelete?.call.arguments[0]?.getText()));
  // Each method is cut out with the chain before it: from that receiver's end to the call's.
  const cut = [onDelete, target].flatMap((method) =>
    method
      ? [{ start: method.receiver.getEnd() - node.getStart(), end: method.call.getEnd() - node.getStart(), text: '' }]
      : [],
  );
  return applyEdits(node.getText(), cut);
}

/**
 * An object literal of `properties`, each its full text with its comments, laid out as `node` was: on one line
 * where it was written on one, a property a line otherwise.
 */
function literal(node: ts.ObjectLiteralExpression, properties: readonly string[]): string {
  if (!properties.length) {
    return '{}';
  }
  if (!node.getText().includes('\n')) {
    return `{ ${properties.map((it) => it.trim()).join(', ')} }`;
  }
  return `{${properties.join(',')},\n${indentOf(node)}}`;
}

/** One chained section, or `undefined` where its findings say why not. */
function chainedSection(
  section: (typeof CHAINED_OPTIONS)[number],
  value: ts.Expression,
  param: string,
  findings: Finding[],
): string | undefined {
  if (isHelped(section)) {
    const callback = sectionCallback(section, value, param, findings, value);
    return callback && `.${section}(${callback})`;
  }
  if (section !== 'computed') {
    return `.${section}(${value.getText()})`;
  }
  const computed = computedSection(value, param);
  if (!computed) findings.push({ node: value, message: "cannot write 'computed' as a section: inline each callback" });
  return computed && `.computed((${param}) => (${computed}))`;
}

/** What each section's helper is named. */
const SECTION_HELPERS = { indexes: 'index', checks: 'check', triggers: 'trigger' } as const;

type HelpedSection = keyof typeof SECTION_HELPERS;

const isHelped = (key: string): key is HelpedSection => Object.hasOwn(SECTION_HELPERS, key);

/** {@link listCallback}, reported against `node` where it cannot be written. */
function sectionCallback(
  section: HelpedSection,
  list: ts.Expression | undefined,
  param: string,
  findings: Finding[],
  node: ts.Node,
): string | undefined {
  const callback = list && listCallback(section, list, param);
  if (!callback) {
    findings.push({
      node,
      message: `cannot write '${section}' as a section: write each entry as ${SECTION_HELPERS[section]}(...) over its refs`,
    });
  }
  return callback;
}

/**
 * A list of indexes, checks or triggers as one callback over the entity's refs, each entry through its helper, so
 * TypeScript checks every key: `(post, index) => [index([post.title], { unique: true })]`. Comments above an entry
 * stay above it.
 */
function listCallback(section: HelpedSection, list: ts.Expression, param: string): string | undefined {
  if (!ts.isArrayLiteralExpression(list)) {
    return undefined;
  }
  const helper = SECTION_HELPERS[section];
  const entries = list.elements.map((entry) => {
    const options = objectLiteral(entry);
    const call = options && helperCall(section, options, param);
    return call && `${leadingComments(entry)}${call}`;
  });
  if (!entries.every((entry) => entry !== undefined)) {
    return undefined;
  }
  const multiline = list.getText().includes('\n');
  const indent = `\n${indentOf(list)}${indentUnit(list.getSourceFile())}`;
  const listed = multiline
    ? `[${entries.map((entry) => (entry.startsWith('\n') ? entry : `${indent}${entry}`)).join(',')},\n${indentOf(list)}]`
    : `[${entries.join(', ')}]`;
  return `(${param}, ${helper}) => ${listed}`;
}

/** One entry as its helper's call: `index(columns, options)`, `check(where, name)` or `trigger({...})`. */
function helperCall(section: HelpedSection, options: ts.ObjectLiteralExpression, param: string): string | undefined {
  const props = optionsByKey(options);
  if (typeof props === 'string') {
    return undefined;
  }
  const read = (key: string) => {
    const value = props.get(key);
    return value && bodyAs(value, param);
  };
  if (section === 'checks') {
    const where = read('where');
    const name = props.get('name')?.getText();
    const others = [...props.keys()].filter((key) => key !== 'where' && key !== 'name');
    return where && !others.length ? `check(${[where, name].filter(Boolean).join(', ')})` : undefined;
  }
  const inlined = (keys: readonly string[]) => {
    const entries = [...props].map(([key, value]) => {
      const text = keys.includes(key) ? bodyAs(value, param) : value.getText();
      return text === undefined ? undefined : `${key}: ${text}`;
    });
    return entries.every((entry) => entry !== undefined) ? entries : undefined;
  };
  if (section === 'triggers') {
    const entries = inlined(['of']);
    return entries && `trigger({ ${entries.join(', ')} })`;
  }
  const columns = read('columns');
  props.delete('columns');
  const rest = inlined(['include', 'where']);
  if (!columns || !rest) {
    return undefined;
  }
  const name = props.get('name');
  if (rest.length === 1 && name && ts.isStringLiteralLike(name)) {
    return `index(${columns}, ${name.getText()})`;
  }
  return rest.length ? `index(${columns}, { ${rest.join(', ')} })` : `index(${columns})`;
}

/** The comments written above `node`, each on its own line, kept as they are; nothing where there are none. */
function leadingComments(node: ts.Node): string {
  const trivia = node.getFullText().slice(0, node.getStart() - node.getFullStart());
  return /\/\/|\/\*/.test(trivia) ? trivia : '';
}

/** `@Entity({ indexes: [...] })`'s lists as sections over the class's refs. */
function entityEdits(cls: ts.ClassLikeDeclaration, findings: Finding[]): Edit[] {
  const param = paramFor(identifierText(cls.name));
  return decoratorsOf(cls).flatMap((decorator) => {
    if (decoratorName(decorator) !== 'Entity' || !ts.isCallExpression(decorator.expression)) {
      return [];
    }
    const options = objectLiteral(decorator.expression.arguments[0]);
    return (options?.properties ?? []).flatMap((prop) => {
      const key = keyOf(prop);
      if (!key || !isHelped(key) || (ts.isPropertyAssignment(prop) && isCallback(prop.initializer))) {
        return [];
      }
      const list = ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
      const callback = sectionCallback(key, list, param, findings, prop);
      return callback && list ? [replaced(list, callback)] : [];
    });
  });
}

/** A schema's computed map as what its section returns: each a column `as()` its SQL. */
function computedSection(value: ts.Expression, param: string): string | undefined {
  const map = objectLiteral(value);
  const entries = map?.properties.map((prop) => {
    if (!ts.isPropertyAssignment(prop)) return undefined;
    const options = optionsByKey(prop.initializer);
    if (typeof options === 'string') return undefined;
    const computed = options.get('computed');
    const expression = computed && bodyAs(computed, param);
    const built = expression && computedBuilder(options, expression);
    return typeof built === 'string' ? `${prop.name.getText()}: ${built}` : undefined;
  });
  return entries?.every((entry) => entry !== undefined) ? `{ ${entries.join(', ')} }` : undefined;
}

/** The variable a call initializes, which names the entity where its `name` is no literal. */
function variableOf(call: ts.CallExpression): ts.Node | undefined {
  let at: ts.Node = call;
  while (ts.isPropertyAccessExpression(at.parent) || ts.isCallExpression(at.parent)) at = at.parent;
  return ts.isVariableDeclaration(at.parent) ? at.parent.name : undefined;
}

/** A property's full text, its comments kept, its value written `value`. */
function withValue(prop: ts.PropertyAssignment, value: string): string {
  const full = prop.getFullText();
  const at = prop.getFullStart();
  return full.slice(0, prop.initializer.getStart() - at) + value + full.slice(prop.initializer.getEnd() - at);
}

/** The names a builder writes, which the file must not bind otherwise. */
export const BUILDER_NAMES: ReadonlySet<string> = new Set(['f', 'Computed']);

/** Whether the file declares anything this pass rewrites. */
const REWRITES = /@(?:Field|Id)\(|\bdefineEntity\(\s*\{|@Entity\(\s*\{/;

/**
 * Writes entity definitions as column builders, `@Field(f.string().nullable())`, and a schema as its columns and a
 * chain of sections. Read off the text the other rewrites produced, so it only moves what is written; whatever it
 * cannot write faithfully is left as it is and reported.
 */
export function toBuilders(
  fileName: string,
  text: string,
  { locate, taken }: { readonly locate?: (at: number) => string; readonly taken: ReadonlySet<string> },
): BuildersResult {
  if (!REWRITES.test(text)) {
    return { ...unedited(text), unresolved: [] };
  }
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const used = new Set<string>();
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node)) {
      edits.push(...decoratorEdits(node, findings, used));
    }
    if (ts.isClassLike(node)) {
      edits.push(...entityEdits(node, findings));
    }
    if (ts.isCallExpression(node) && identifierText(node.expression) === 'defineEntity') {
      const schema = schemaEdits(node, findings, used);
      if (schema.length) {
        edits.push(...schema);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const located = locate ?? ((at: number) => locationAt(source, at));
  const unresolved = formatFindings(findings, located);
  if (!edits.length) {
    return { ...unedited(text), unresolved };
  }
  const clash = [...used].find((name) => taken.has(name));
  if (clash) {
    return {
      ...unedited(text),
      unresolved: [
        ...unresolved,
        `${located(0)}: '${clash}' is already named here, and the codemod writes it: rename that, then run again`,
      ],
    };
  }
  return { ...reparsedAgain(fileName, editedText(text, edits), (edited) => importEdits(edited, used)), unresolved };
}

/** Imports what the pass now writes, `f` and `Computed`, and no longer the field decorators it replaced, once unspelled. */
function importEdits(source: ts.SourceFile, used: ReadonlySet<string>): readonly Edit[] {
  const [declaration] = uqlImportDeclarations(source, true);
  if (!declaration) {
    return used.size ? [{ start: 0, end: 0, text: `${importText('import', [...used].toSorted(), 'uql-orm')}\n` }] : [];
  }
  const names = new Set(declaration.elements.map((it) => it.name.text));
  const added = [...used].filter((name) => !names.has(name)).toSorted();
  const dead = deadImports(declaration.elements, FIELD_DECORATORS, spelledNames(source));
  const first = declaration.elements.find((it) => !dead.includes(it));
  if (!first) {
    return [replaced(declaration.declaration, importText('import', added, 'uql-orm'))];
  }
  const removals = importRemovalEdits(declaration.declaration, declaration.elements, dead);
  return added.length ? [...removals, inserted(first, `${added.join(', ')}, `)] : removals;
}
