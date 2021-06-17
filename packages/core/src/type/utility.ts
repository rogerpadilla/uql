export type Type<T> = new (...args: any[]) => T;

export type Scalar = boolean | string | number | bigint | Date | Symbol;

export type Writable<T> = { -readonly [K in keyof T]: T[K] };

export type Unpacked<T> = T extends (infer U)[]
  ? U
  : T extends (...args: any[]) => infer U
  ? U
  : T extends Promise<infer U>
  ? U
  : T;
