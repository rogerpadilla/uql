expect.extend({
  toMatch(received, expected) {
    const pass = expected.test(received) && !this.isNot;
    return {
      message: () => `expected ${received} to match ${expected}`,
      pass,
    };
  },
});
