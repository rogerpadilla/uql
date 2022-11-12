declare namespace jest {
  export interface Expect {
    toMatch: (received: RegExp) => any;
  }
}
