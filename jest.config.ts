import { readFileSync } from 'node:fs';
import type { Config } from 'jest';

process.env.TZ = 'UTC';

const swcConfig = JSON.parse(readFileSync(`.swcrc`, 'utf-8'));

const jestConfig: Config = {
  verbose: true,
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  watchPathIgnorePatterns: ['node_modules', '\\/data\\/', 'coverage', 'dist'],
  testPathIgnorePatterns: ['node_modules', '\\/data\\/', 'coverage', 'dist'],
  moduleNameMapper: {
    '^uql/(.+)\\.js$': '<rootDir>/packages/uql/src/$1',
    '^uql/(.+)(?<!\\.js)$': '<rootDir>/packages/uql/src/$1',
    '^uql$': '<rootDir>/packages/uql/src/index.ts',
    '(\\.+/.+)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { ...swcConfig }],
  },
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.ts'],
  // this is intentional as it is, use 'npm run test.all' to run all tests
  testMatch: ['**/*.spec.ts', '**/*.it.ts'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules', 'test'],
  modulePathIgnorePatterns: ['dist'],
};

export default jestConfig;
