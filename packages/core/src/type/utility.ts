// export type Type<T> = new (...args: any[]) => T;

export type Scalar = boolean | string | number | bigint | Date | Symbol;

export interface Type<T> extends Function {
  new (...args: any[]): T;
}

export type Writable<T> = { -readonly [P in keyof T]: T[P] };

export type Unpacked<T> = T extends (infer U)[]
  ? U
  : T extends (...args: any[]) => infer U
  ? U
  : T extends Promise<infer U>
  ? U
  : T;
