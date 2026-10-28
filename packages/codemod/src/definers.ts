import ts from 'typescript';
import { identifierText } from './syntax.js';

/** The definers a class was registered with, each with the decorator that registers the same on a decorated class. */
export const CLASS_DEFINERS = {
  defineEntity: '@Entity',
  defineField: '@Field',
  defineId: '@Id',
  defineRelation: 'a relation decorator',
  defineHook: 'a hook decorator',
  defineIndex: "@Entity's 'indexes'",
  defineTrigger: "@Entity's 'triggers'",
  defineFilter: "@Entity's 'filters'",
} as const;

export type DefinerName = keyof typeof CLASS_DEFINERS;

const isDefinerName = (name: string | undefined): name is DefinerName =>
  name !== undefined && Object.hasOwn(CLASS_DEFINERS, name);

/** The definers naming a member or a filter after the entity, their options after that. */
const KEYED_DEFINERS: ReadonlySet<DefinerName> = new Set<DefinerName>([
  'defineField',
  'defineId',
  'defineRelation',
  'defineHook',
  'defineFilter',
]);

/** A class-form definer's arguments by what each is: `defineX(Entity, key?, options)`, every one after the entity in `rest`. */
export type DefinerCall = {
  readonly call: ts.CallExpression;
  readonly definer: DefinerName;
  readonly entity: ts.Expression;
  readonly key: string | undefined;
  readonly options: ts.Expression | undefined;
  readonly rest: readonly ts.Expression[];
};

/** `call` read as a class-form definer, or nothing where it is another call, the defined form included. */
export function definerCall(call: ts.CallExpression): DefinerCall | undefined {
  const definer = identifierText(call.expression);
  const [entity, ...rest] = call.arguments;
  if (!isDefinerName(definer) || !entity || ts.isObjectLiteralExpression(entity)) {
    return undefined;
  }
  const [second, third] = rest;
  const keyed = KEYED_DEFINERS.has(definer);
  const key = keyed && second && ts.isStringLiteralLike(second) ? second.text : undefined;
  return { call, definer, entity, key, options: keyed ? third : second, rest };
}
