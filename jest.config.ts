import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(`.swcrc`, 'utf-8'));

const jestConfig = {
  verbose: true,
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  watchPathIgnorePatterns: ['node_modules', 'data', 'coverage', 'dist'],
  testPathIgnorePatterns: ['node_modules', 'data', 'coverage', 'dist'],
  moduleNameMapper: {
    '^nukak/(.+)\\.js$': '<rootDir>/packages/core/src/$1',
    '^nukak/(.+)(?<!\\.js)$': '<rootDir>/packages/core/src/$1',
    '(\\.+/.+)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { ...config }],
  },
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.ts'],
  testMatch: ['**/*.spec.ts', '**/sqlite/**/*.it.ts'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules', 'test'],
  modulePathIgnorePatterns: ['dist'],
};

export default jestConfig;
