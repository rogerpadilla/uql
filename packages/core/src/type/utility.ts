export type Type<T> = new (...args: any[]) => T;

export type BooleanLike = boolean | 0 | 1;

export type Scalar = boolean | string | number | bigint | Symbol | Date | RegExp | Buffer | { toHexString(): string };

export type ExpandScalar<T> = null | (T extends Date ? Date | string : T);

export type Writable<T> = { -readonly [K in keyof T]: T[K] };

export type Unpacked<T> = T extends (infer U)[] ? U : T extends (...args: any[]) => infer U ? U : T extends Promise<infer U> ? U : T;
