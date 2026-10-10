import ts from 'typescript';
import { original, type Part } from './edits.js';
import { templateOf, templateWith } from './entitySql.js';

/**
 * A quoted string or identifier, or a comment, skipped; a `?` or `$n` placeholder; or a character a placeholder
 * could hide behind that this does not read: an unclosed quote or comment, a backslash, a `#`, any other `$`.
 */
const SQL_TOKEN = /('(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/)|(\?)|\$([1-9]\d*)|[$\\#'"`]|\/\*/g;

/** A statement split at its placeholders: the text around them, and the index of the value each binds. */
type Placeholders = { readonly texts: readonly string[]; readonly values: readonly number[] };

/** `sql` split at its placeholders where they are all `?` or all `$n` and bind exactly `count` values. */
function placeholdersOf(sql: string, count: number): Placeholders | undefined {
  const texts: string[] = [];
  const values: number[] = [];
  const styles = new Set<string>();
  let from = 0;
  for (const { 0: token, 1: skipped, 2: question, 3: position, index } of sql.matchAll(SQL_TOKEN)) {
    if (skipped !== undefined) {
      if (/\?|\$\d/.test(skipped)) {
        return undefined;
      }
      continue;
    }
    if (!question && !position) {
      return undefined;
    }
    styles.add(question ? '?' : '$');
    values.push(position ? Number(position) - 1 : values.length);
    texts.push(sql.slice(from, index));
    from = index + token.length;
  }
  texts.push(sql.slice(from));
  const exact = new Set(values).size === count && values.every((value) => value < count);
  return styles.size <= 1 && exact ? { texts, values } : undefined;
}

/**
 * A querier's `run(sql, values)` statement as the template its tag takes, each placeholder replaced by the value
 * it binds, or nothing where that is not certain: the SQL is no literal, or the values no array literal of
 * plain elements, or its placeholders cannot be told apart from the rest of the text.
 */
export function statementTemplate(sql: ts.Expression, values: readonly ts.Expression[]): readonly Part[] | undefined {
  if (!ts.isStringLiteral(sql) && !ts.isNoSubstitutionTemplateLiteral(sql)) {
    return undefined;
  }
  if (!values.length) {
    return [templateOf(sql.text)];
  }
  const [list] = values;
  const elements = ts.isArrayLiteralExpression(list) ? list.elements : undefined;
  if (values.length > 1 || !elements || elements.some((it) => ts.isSpreadElement(it) || ts.isOmittedExpression(it))) {
    return undefined;
  }
  const placeholders = placeholdersOf(sql.text, elements.length);
  if (!placeholders || placeholders.values.some((at) => isReused(placeholders.values, at) && !isPlain(elements[at]))) {
    return undefined;
  }
  return templateWith(
    placeholders.texts,
    placeholders.values.map((at) => original(elements[at])),
  );
}

/** A value read twice in the template is evaluated twice, which only a name or a literal can do unseen. */
const isPlain = (value: ts.Expression): boolean =>
  ts.isIdentifier(value) || ts.isNumericLiteral(value) || ts.isStringLiteral(value);

const isReused = (values: readonly number[], at: number): boolean => values.filter((value) => value === at).length > 1;
