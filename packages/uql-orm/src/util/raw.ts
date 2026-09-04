import { QueryRaw, type QueryRawFn, type Scalar } from '../type/index.js';

/**
 * Create a raw SQL expression.
 *
 * As a tagged template the literal text is emitted as written and every interpolation is resolved by
 * what it is, so a value cannot become SQL whatever it holds:
 *
 * | Interpolated       | Becomes                 |
 * | :----------------- | :---------------------- |
 * | any value          | a bound parameter       |
 * | a {@link QueryRaw} | that fragment, in place |
 *
 * ```ts
 * raw`GREATEST(0, "creditsAllowance" - ${amount})`
 * raw`CONCAT(${col('firstName')}, ' ', ${col('lastName')})`
 * raw`LOG10(${points})`.as('score')
 * ```
 *
 * The callback form remains for SQL a template cannot express, such as a sub-query generated through
 * `dialect.find(...)`. See {@link col} for a context-aware column reference.
 *
 * **⚠️ Security:** the tag is safe because it binds; the other two forms are not. `raw('SQL')` emits
 * its argument verbatim and a callback emits whatever it writes, so build neither from user input.
 * Inside a callback, bind with `ctx.addValue()`.
 */
export function raw(strings: TemplateStringsArray, ...values: readonly unknown[]): QueryRaw;
export function raw(value: QueryRawFn, alias?: string): QueryRaw;
/**
 * @deprecated Emits its argument verbatim, so it cannot bind a value. Use the tagged template:
 * `raw('"a" > 1')` becomes `` raw`"a" > 1` ``, and `raw('LOG10(x)', 'score')` becomes
 * `` raw`LOG10(x)`.as('score') ``. `npx uql-codemod` rewrites both.
 */
export function raw(value: Scalar, alias?: string): QueryRaw;
export function raw(value: Scalar | QueryRawFn | TemplateStringsArray, ...rest: readonly unknown[]): QueryRaw {
  const [alias] = rest;
  if (!isTemplateStrings(value)) {
    return new QueryRaw(value, typeof alias === 'string' ? alias : undefined);
  }
  if (!rest.length) {
    // Nothing to bind, so this is the string form: keep it one, for the DDL paths that need to read
    // the expression back as text (an index expression cannot carry a parameter).
    return new QueryRaw(value[0] ?? '');
  }
  return new QueryRaw((opts) => {
    const { ctx } = opts;
    ctx.append(value[0] ?? '');
    rest.forEach((interpolated, i) => {
      if (interpolated instanceof QueryRaw) {
        interpolated.render(opts);
      } else {
        ctx.addValue(interpolated);
      }
      ctx.append(value[i + 1] ?? '');
    });
  });
}

/**
 * A column of the entity being queried, alias-qualified and escaped for the dialect. This is what a
 * template cannot know on its own: the alias is decided while the statement is built, not where the
 * expression is written.
 *
 * Takes the column name as it exists in the database, not the entity's field name: no entity metadata
 * is in scope here, so a naming strategy is not applied for you. `escapedPrefix` already carries its
 * trailing dot, which is the detail this exists to stop you getting wrong.
 */
export function col(column: string): QueryRaw {
  return new QueryRaw(({ escapedPrefix, dialect }) => escapedPrefix + dialect.escapeId(column, true));
}

/** A tag call passes the frozen strings array, which carries its own `raw` counterpart. */
function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray(Reflect.get(value, 'raw'));
}
