expect.extend({
  toMatch(received, expected) {
    const fits = expected.test(received);
    const pass = !!fits && !this.isNot;
    return {
      message: () => `expected ${received.toString()} to match ${expected.toString()}`,
      pass,
    };
  },
});

jest.setTimeout(20_000);
