expect.extend({
  toMatch(received, expected) {
    const pass = expected.test(received) && !this.isNot;
    return {
      message: () => `expected ${received} to match ${expected}`,
      pass,
    };
  },
  toStartsWith(received, expected) {
    const pass = received.startsWith(expected) && !this.isNot;
    return {
      message: () => `expected ${received} to starts with ${expected}`,
      pass,
    };
  },
});

jest.setTimeout(3000);
