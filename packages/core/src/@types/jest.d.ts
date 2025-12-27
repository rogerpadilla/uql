/** biome-ignore-all lint/style/noNamespace: intentionally */
declare namespace jest {
  export interface Expect {
    toMatch: (received: RegExp) => any;
  }
}
