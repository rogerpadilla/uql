expect.extend({
  toStartsWith(received, expected) {
    const pass = received.startsWith(expected) && !this.isNot;
    return {
      message: () => `expected ${received} to starts with ${expected}`,
      pass,
    };
  },
});
