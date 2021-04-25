// declare module 'sqlstring' {
//   export function escape(value: any): string;
//   export function escapeId(value: any, dotQualifier?: boolean): string;
//   export function objectToValues(value: any): string;
// }

declare namespace Express {
  export interface Request {
    identity?: {
      readonly company: number;
      readonly user: number;
    };
  }
}

declare namespace jest {
  export interface Expect {
    toMatch: (received: RegExp) => any;
  }
}
