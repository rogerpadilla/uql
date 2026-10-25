import ts from 'typescript';
import { call, flag, flagOrCall, type OptionMethod } from './columnMethods.js';
import { type Finding, formatFindings, locationAt } from './context.js';
import { applyEdits, type Edit, replaced } from './edits.js';
import { type ChainMethod, chainOf, identifierText, propertiesByKey } from './syntax.js';

/** The migration builder's calls a column is declared by, and the callback each hands its builder to. */
const DECLARING_CALLS = new Set(['createTable', 'alterTable', 'addColumn', 'alterColumn']);

/** The column factories of a migration's table builder. */
export const FACTORY_NAMES = [
  'id',
  'integer',
  'smallint',
  'bigint',
  'float',
  'double',
  'decimal',
  'string',
  'char',
  'text',
  'boolean',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
  'uuid',
  'blob',
  'vector',
] as const;

const FACTORIES: ReadonlySet<string> = new Set(FACTORY_NAMES);

/** A chained method renamed, or removed where it now says what a column already is. */
const RENAMED: Readonly<Record<string, (args: readonly string[]) => string>> = {
  notNullable: () => '',
  nullable: ([value]) => (value === 'false' ? '' : '.nullable()'),
  defaultValue: (args) => `.default(${args.join(', ')})`,
  primaryKey: () => '.id()',
  computed: (args) => `.as(${args.join(', ')})`,
};

/** Each column option the factories took as a method now, in the order a column chains them. */
const OPTION_METHODS: readonly OptionMethod<string | undefined>[] = [
  ['length', call('length')],
  ['precision', call('precision')],
  ['scale', call('scale')],
  ['nullable', flag('nullable')],
  ['primaryKey', flag('id')],
  ['autoIncrement', flag('autoIncrement')],
  ['unique', flag('unique')],
  ['unsigned', flag('unsigned')],
  ['defaultValue', call('default')],
  ['index', flagOrCall('index')],
  ['comment', call('comment')],
];

export type MigrationBuildersResult = { readonly text: string; readonly unresolved: string[] };

/**
 * Writes a migration's columns in an entity column's vocabulary: `table.string('email', { length: 80 })` as
 * `table.string('email').length(80)`, `.defaultValue()` as `.default()`, `.primaryKey()` as `.id()`, `.computed()`
 * as `.as()`, and `.notNullable()` dropped, a column being NOT NULL already. Only a chain off the builder a
 * `createTable`, `alterTable`, `addColumn` or `alterColumn` callback is handed, so no other `.string()` is touched.
 */
export function toMigrationBuilders(
  fileName: string,
  text: string,
  locate?: (at: number) => string,
): MigrationBuildersResult {
  if (![...DECLARING_CALLS].some((call) => text.includes(`${call}(`))) {
    return { text, unresolved: [] };
  }
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isDeclaringCall(node)) {
      for (const callback of node.arguments) {
        const builder = ts.isArrowFunction(callback) && identifierText(callback.parameters[0]?.name);
        if (builder) {
          collect(callback.body, builder, edits, (at, message) => findings.push({ node: at, message }));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return {
    text: edits.length ? applyEdits(text, edits) : text,
    unresolved: formatFindings(findings, locate ?? ((at) => locationAt(source, at))),
  };
}

function isDeclaringCall(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression) && DECLARING_CALLS.has(call.expression.name.text);
}

/** Each column chain in `body` rooted at `builder`, the outermost call of each rewritten whole. */
function collect(body: ts.Node, builder: string, edits: Edit[], report: (at: ts.Node, message: string) => void): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && !isChained(node)) {
      const rewritten = chainSource(node, builder, report);
      if (rewritten !== undefined) {
        if (rewritten !== node.getText()) edits.push(replaced(node, rewritten));
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Whether `call` is the receiver of a further call in the chain, which the outermost one rewrites. */
function isChained(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.parent);
}

/** The chain as source in the new vocabulary, or `undefined` where it is no column chain off `builder`. */
function chainSource(
  outer: ts.CallExpression,
  builder: string,
  report: (at: ts.Node, message: string) => void,
): string | undefined {
  const { root, methods } = chainOf(outer);
  const [first, ...chained] = methods;
  if (!first || identifierText(root) !== builder || !FACTORIES.has(first.name)) {
    return undefined;
  }
  const start = factorySource(first.call, first.name, builder, report);
  if (start === undefined) {
    return outer.getText();
  }
  return start + chained.map(methodSource).join('');
}

/** `table.vector('embedding', { dimensions: 3, nullable: true })` as `table.vector('embedding', 3).nullable()`. */
function factorySource(
  root: ts.CallExpression,
  factory: string,
  builder: string,
  report: (at: ts.Node, message: string) => void,
): string | undefined {
  const [name, options] = root.arguments;
  const nameText = name?.getText() ?? '';
  if (!options) {
    return root.getText();
  }
  const props = propertiesByKey(options);
  if (!props) {
    report(root, `cannot write '${options.getText()}' as the column's methods: chain each option as one`);
    return undefined;
  }
  const text = (key: string) => {
    const value = props.get(key)?.getText();
    props.delete(key);
    return value;
  };
  const args = [nameText];
  if (factory === 'vector') {
    const dimensions = text('dimensions');
    if (dimensions !== undefined) args.push(dimensions);
  }
  const references = props.get('references');
  props.delete('references');
  const methods: string[] = [];
  for (const [option, method] of OPTION_METHODS) {
    const value = text(option);
    const written = value === undefined ? '' : method(value);
    if (written === undefined) {
      report(root, `cannot write '${option}: ${value}' as a method: chain it, or not, by hand`);
      return undefined;
    }
    methods.push(written);
  }
  if (props.size) {
    report(root, `has options no column method writes: ${[...props.keys()].join(', ')}`);
    return undefined;
  }
  const foreign = references && referencesSource(references);
  if (references && foreign === undefined) {
    report(root, `cannot write '${references.getText()}' as '.references(table, column)'`);
    return undefined;
  }
  return `${builder}.${factory}(${args.join(', ')})${methods.join('')}${foreign ?? ''}`;
}

/** `{ table: 'users', column: 'id', onDelete: 'CASCADE' }` as `.references('users', 'id').onDelete('CASCADE')`. */
function referencesSource(value: ts.Expression): string | undefined {
  const props = propertiesByKey(value);
  const table = props?.get('table')?.getText();
  if (!table) {
    return undefined;
  }
  const [column, onDelete, onUpdate] = ['column', 'onDelete', 'onUpdate'].map((key) => props?.get(key)?.getText());
  return (
    `.references(${[table, column].filter(Boolean).join(', ')})` +
    (onDelete ? `.onDelete(${onDelete})` : '') +
    (onUpdate ? `.onUpdate(${onUpdate})` : '')
  );
}

/** One chained call in the new vocabulary. */
function methodSource({ call, name }: ChainMethod): string {
  const args = call.arguments.map((arg) => arg.getText());
  const rename = RENAMED[name];
  return rename ? rename(args) : `.${name}(${args.join(', ')})`;
}
