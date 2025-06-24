/** biome-ignore-all lint/style/noNamespace: compat */
declare namespace jest {
  export interface Expect {
    toMatch: (received: RegExp) => any;
  }
}
