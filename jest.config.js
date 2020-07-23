module.exports = {
  verbose: true,
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.js'],
  roots: ['<rootDir>/packages'],
  testMatch: ['**/*.spec.ts'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary'],
  coverageDirectory: 'coverage',
};
