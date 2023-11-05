export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type DeepWriteable<T> = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  -readonly [K in keyof T]: T[K] extends Function ? T[K] : DeepWriteable<T[K]>;
};

export type AnyFunction = (...args: any[]) => any;

/**
 * Returns all shallow properties that accept `undefined` or `null`.
 * Does not include Optional properties, only `undefined` or `null`.
 *
 * @example
 * ```typescript
 * type UndefinedProps = NullishPropertiesOf<{
 *   id: number | undefined,
 *   createdAt: string | undefined,
 *   firstName: string | null, // nullable properties are included
 *   lastName?: string, // optional properties are not included.
 * }>;
 *
 * // is equal to
 *
 * type UndefinedProps = 'id' | 'createdAt' | 'firstName';
 * ```
 */
export type NullishPropertiesOf<T> = {
  [P in keyof T]-?: undefined extends T[P] ? P : null extends T[P] ? P : never;
}[keyof T];

/**
 * Makes all shallow properties of an object `optional` if they accept `undefined` or `null` as a value.
 *
 * @example
 * ```typescript
 * type MyOptionalType = MakeUndefinedOptional<{
 *   id: number | undefined,
 *   firstName: string,
 *   lastName: string | null,
 * }>;
 *
 * // is equal to
 *
 * type MyOptionalType = {
 *   // this property is optional.
 *   id?: number | undefined,
 *   firstName: string,
 *   // this property is optional.
 *   lastName?: string | null,
 * };
 * ```
 */
export type MakeNullishOptional<T extends object> = PartialBy<T, NullishPropertiesOf<T>>;

/**
 * Makes the type accept null & undefined
 */
export type Nullish<T> = T | null | undefined;

export type NonNullish<T> = T extends null | undefined ? never : T;

export type NonUndefined<T> = T extends undefined ? never : T;

export type NonUndefinedKeys<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? NonUndefined<T[P]> : T[P];
};

export type AllowArray<T> = T | T[];

export type AllowIterable<T> = T | Iterable<T>;

export type AllowLowercase<T extends string> = T | Lowercase<T>;

export type AllowReadonlyArray<T> = T | readonly T[];

export type ConstructorKeys<T> = { [P in keyof T]: T[P] extends new () => any ? P : never }[keyof T];

type NonConstructorKeys<T> = { [P in keyof T]: T[P] extends new () => any ? never : P }[keyof T];

export type OmitConstructors<T> = Pick<T, NonConstructorKeys<T>>;

/**
 * Type helper for making certain fields of an object optional.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

export type StrictRequiredBy<T, K extends keyof T> = NonUndefinedKeys<Omit<T, K> & Required<Pick<T, K>>, K>;

export type ReadOnlyRecord<K extends PropertyKey, V> = Readonly<Record<K, V>>;

export type Falsy = false | 0 | -0 | 0n | '' | null | undefined;

export type SQLFragment = string | Falsy | SQLFragment[];
export type TruthySQLFragment = string | SQLFragment[];

export type DateLike = number | string | Date;

export class MapView<K, V> {
  #target: Map<K, V>;

  constructor(target: Map<K, V>) {
    this.#target = target;
  }

  /**
   * Returns a specified element from the Map object. If the value that is associated to the provided key is an object, then you will get a reference to that object and any change made to that object will effectively modify it inside the Map.
   *
   * @param key
   * @returns Returns the element associated with the specified key. If no element is associated with the specified key, undefined is returned.
   */
  get(key: K): V | undefined {
    return this.#target.get(key);
  }

  /**
   * @param key
   * @returns boolean indicating whether an element with the specified key exists or not.
   */
  has(key: K): boolean {
    return this.#target.has(key);
  }

  /**
   * @returns the number of elements in the Map.
   */
  get size(): number {
    return this.#target.size;
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.#target[Symbol.iterator]();
  }

  entries(): IterableIterator<[K, V]> {
    return this.#target.entries();
  }

  keys(): IterableIterator<K> {
    return this.#target.keys();
  }

  values(): IterableIterator<V> {
    return this.#target.values();
  }

  toJSON() {
    return [...this.#target.entries()];
  }
}
