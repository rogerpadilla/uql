/* oxlint-disable typescript/no-namespace -- compat */
declare namespace jest {
  export interface Expect {
    toMatch: (received: RegExp) => void;
  }
}
