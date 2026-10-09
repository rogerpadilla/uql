import ts from 'typescript';
import type { Edit } from './edits.js';
import { paramFor } from './keyMaps.js';
import { identifierText } from './syntax.js';

/** What a rewrite of one file reads and writes. */
export type Context = {
  readonly source: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  /** Whether the project checks nulls; without it a `| null` written on a property changes nothing. */
  readonly strictNullChecks: boolean;
  readonly edits: Edit[];
  readonly unresolved: string[];
  readonly notes: string[];
  /** Names written that the file has to import from `uql-orm`, each with what it was written for. */
  readonly imports: Map<string, string>;
  /** Uses rewritten of each name whose import goes once every use was: `Relation<T>` unwrapped, `expr` defaults. */
  readonly rewritten: { Relation: number; expr: number };
  /** Records what needs a human, at `node`. */
  readonly report: (node: ts.Node, message: string) => void;
  /** Records a rewrite that is correct but worth a second look, at `node`. */
  readonly note: (node: ts.Node, message: string) => void;
};

export function createContext(source: ts.SourceFile, checker: ts.TypeChecker, strictNullChecks: boolean): Context {
  const unresolved: string[] = [];
  const notes: string[] = [];
  const at = (node: ts.Node) => `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  return {
    source,
    checker,
    strictNullChecks,
    edits: [],
    unresolved,
    notes,
    imports: new Map(),
    rewritten: { Relation: 0, expr: 0 },
    report: (node, message) => {
      unresolved.push(`${at(node)}: ${message}`);
    },
    note: (node, message) => {
      notes.push(`${at(node)}: ${message}`);
    },
  };
}

/** The entity a definition describes: the parameter its callbacks are named after, and the node naming it. */
export type Owner = { readonly param: string; readonly entity: ts.Node };

/** The owner a class, or an expression naming one, defines. */
export function ownerOf(entity: ts.Node): Owner {
  return { param: paramFor(identifierText(ts.isClassLike(entity) ? entity.name : entity)), entity };
}

/** The instance type a class type constructs, if it constructs one. */
export function constructedType(type: ts.Type): ts.Type | undefined {
  return type.getConstructSignatures()[0]?.getReturnType();
}

/** The instance type of the entity `node` declares or names. */
export function instanceTypeOf(node: ts.Node, checker: ts.TypeChecker): ts.Type {
  const type = checker.getTypeAtLocation(node);
  return constructedType(type) ?? type;
}

export function propertyNames(type: ts.Type): ReadonlySet<string> {
  return new Set(type.getProperties().map(({ name }) => name));
}

/** The names of the members of the entity `node` declares or names. */
export function memberNames(node: ts.Node, checker: ts.TypeChecker): ReadonlySet<string> {
  return propertyNames(instanceTypeOf(node, checker));
}
