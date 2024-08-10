import type { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  verbose: true,
  extensionsToTreatAsEsm: ['.ts'],
  watchPathIgnorePatterns: ['node_modules', 'data', 'coverage'],
  moduleNameMapper: {
    '^(nukak)/(.+)\\.js$': '<rootDir>/packages/$1/src/$2',
    '^(nukak)/(.+)(?<!\\.js)$': '<rootDir>/packages/$1/src/$2',
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
  testPathIgnorePatterns: ['node_modules', 'dist'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules', 'test'],
  modulePathIgnorePatterns: ['dist'],
};

export default jestConfig;
