expect.extend({
  toMatch(received, expected) {
    const fits = expected instanceof RegExp ? expected.test(received) : received.match(expected);
    const pass = !!fits && !this.isNot;
    return {
      message: () => `expected ${received.toString()} to match ${expected.toString()}`,
      pass,
    };
  },
});
