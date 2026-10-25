/** How an option's value becomes a column method, or `undefined` where it cannot be written as one. */
export type OptionMethod<R extends string | undefined = string> = readonly [
  option: string,
  method: (value: string) => R,
];

/** The option's value passed to `method`: `.length(80)`. */
export const call =
  (method: string) =>
  (value: string): string =>
    `.${method}(${value})`;

/** A flag as its method where it is `true`, nothing where `false`, and `undefined` where no literal says. */
export const flag =
  (method: string) =>
  (value: string): string | undefined =>
    value === 'true' ? `.${method}()` : value === 'false' ? '' : undefined;

/** {@link flag}, its value passed to the method where it is no literal. */
export const flagOrCall =
  (method: string) =>
  (value: string): string =>
    flag(method)(value) ?? call(method)(value);
