declare module 'sqlstring' {
  export function escape(value: any): string;
  export function escapeId(value: any, dotQualifier?: boolean): string;
  export function objectToValues(value: any): string;
}

declare namespace Express {
  export interface Request {
    identity?: {
      readonly company: number;
      readonly user: number;
    };
  }
}

declare namespace jest {
  type toStartsWith<R> = (received: string) => R;

  export interface Expect {
    toStartsWith: toStartsWith<boolean>;
  }
  export interface Matchers<R> {
    toStartsWith: toStartsWith<R>;
  }
}
