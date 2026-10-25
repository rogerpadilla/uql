import type { FieldType, IndexEntry } from '../../type/index.js';
import { JSON_KEY_PATTERN } from '../../util/field.util.js';

/** One token of an index expression as an engine reprints it; anything else leaves the expression unread. */
const TOKEN = /\s+|'(?:[^']|'')*'|"(?:[^"]|"")+"|`(?:[^`]|``)+`|->>|->|::|[(),=]|\d+|[A-Za-z_][\w$]*/y;

/** The words uql's JSON path reads reprint as on every engine; any other word is the column, or something uql never wrote. */
const READ_WORDS = new Set([
  'array',
  'as',
  'case',
  'cast',
  'char',
  'charset',
  'collate',
  'datetime',
  'double',
  'else',
  'end',
  'json_extract',
  'json_unquote',
  'jsonb_typeof',
  'null',
  'numeric',
  'real',
  'signed',
  'text',
  'then',
  'utf8mb4',
  'utf8mb4_bin',
  'when',
]);

/** The element types MySQL's `CAST(... AS <type> ARRAY)` reprints, as uql declares them. */
const ARRAY_TYPES: ReadonlyMap<string, FieldType> = new Map<string, FieldType>([
  ['char', String],
  ['signed', Number],
  ['datetime', Date],
]);

const PATH_LITERAL = new RegExp(`^'\\$((?:\\.${JSON_KEY_PATTERN})*)'$`, 'u');
const KEY_LITERAL = new RegExp(`^'(${JSON_KEY_PATTERN})'$`, 'u');

type Token = { readonly text: string; readonly word: string };

/**
 * An index entry an engine reports as an expression, read back as the JSON path entry uql compiled it from where it is
 * one (`{ json, path, type, charLength }`), as MongoDB reports a path; the expression where it is anything else.
 */
export function readIndexEntry(expression: string): IndexEntry<string> {
  return jsonIndexEntry(expression) ?? { expression };
}

function jsonIndexEntry(expression: string): IndexEntry<string> | undefined {
  const tokens = tokenize(expression);
  if (!tokens) {
    return undefined;
  }
  const then = tokens.findIndex((token) => token.word === 'then');
  const read = then < 0 ? tokens : tokens.slice(then + 1);
  const columns = new Set(tokens.flatMap(identifier));
  const path = pathOf(tokens, read);
  const [json] = columns;
  if (columns.size !== 1 || json === undefined || path === undefined) {
    return undefined;
  }
  const typed = typeOf(read);
  if (!typed) {
    return undefined;
  }
  return { json, ...(path && { path }), ...typed };
}

/** The tokens of `expression`, `undefined` where one is no token uql's reads reprint as. */
function tokenize(expression: string): Token[] | undefined {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.length) {
    const match = TOKEN.exec(expression);
    if (!match) {
      return undefined;
    }
    if (match[0].trim()) {
      tokens.push({ text: match[0], word: /^[A-Za-z_]/.test(match[0]) ? match[0].toLowerCase() : '' });
    }
  }
  return tokens;
}

/** The column a token names: a quoted identifier, or a word no read reprints as. */
function identifier({ text, word }: Token): string[] {
  const quoted = /^(["`])(.*)\1$/s.exec(text);
  if (quoted) {
    return [quoted[2].replaceAll(quoted[1] + quoted[1], quoted[1])];
  }
  return word && !READ_WORDS.has(word) ? [text] : [];
}

/**
 * The dotted path the read reaches: a `'$.a.b'` literal (MySQL, SQLite), or Postgres's chain of `-> 'a'` keys, read
 * past a `CASE`'s type test. `undefined` where a literal is anything else, which no read of uql's holds.
 */
function pathOf(tokens: readonly Token[], read: readonly Token[]): string | undefined {
  const typeTest = tokens.some((token) => token.word === 'case');
  const keyOf = (all: readonly Token[], at: number) =>
    at > 0 && all[at - 1].text.startsWith('->') ? KEY_LITERAL.exec(all[at].text)?.[1] : undefined;
  const known = tokens.every(
    ({ text }, at) =>
      !text.startsWith("'") ||
      PATH_LITERAL.test(text) ||
      keyOf(tokens, at) !== undefined ||
      (typeTest && text === "'number'"),
  );
  const paths = tokens.flatMap((token) => PATH_LITERAL.exec(token.text)?.[1] ?? []);
  if (!known || paths.length > 1) {
    return undefined;
  }
  return paths.length ? paths[0].slice(1) : read.flatMap((_, at) => keyOf(read, at) ?? []).join('.');
}

/** The type and key length a read casts its value to: none for text, a number, a JSON value (a boolean) or each element. */
function typeOf(read: readonly Token[]): Pick<IndexEntry<string>, 'type' | 'charLength'> | undefined {
  const words = read.map((token) => token.word);
  const charLength = words.includes('char') ? Number(read[words.indexOf('char') + 2]?.text) : undefined;
  const sized = charLength === undefined ? {} : { charLength };
  const elements = words.indexOf('array');
  if (elements >= 0) {
    const cast = words.slice(0, elements).findLast((word) => ARRAY_TYPES.has(word));
    const type = cast === undefined ? undefined : ARRAY_TYPES.get(cast);
    return type && { type: [type], ...sized };
  }
  if (words.some((word) => word === 'double' || word === 'real' || word === 'numeric')) {
    return { type: Number };
  }
  const asJson = !words.some((word) => word === 'json_extract') && !read.some((token) => token.text === '->>');
  return asJson ? { type: Boolean } : sized;
}
