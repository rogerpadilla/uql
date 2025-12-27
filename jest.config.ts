import type { Config } from 'jest';

const jestConfig: Config = {
  verbose: true,
  extensionsToTreatAsEsm: ['.ts'],
  watchPathIgnorePatterns: ['node_modules', 'data', 'coverage', 'dist'],
  testPathIgnorePatterns: ['node_modules', 'data', 'coverage', 'dist'],
  moduleNameMapper: {
    '^nukak/(.+)\\.js$': '<rootDir>/packages/core/src/$1',
    '^nukak/(.+)(?<!\\.js)$': '<rootDir>/packages/core/src/$1',
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        useESM: true,
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.js'],
  testMatch: ['**/*.spec.ts', '**/sqlite/**/*.it.ts'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules', 'test'],
  modulePathIgnorePatterns: ['dist'],
};

export default jestConfig;
