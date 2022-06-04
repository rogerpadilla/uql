import tsconfig from './tsconfig.json';

const tsConfigPaths = tsconfig.compilerOptions.paths;

const moduleNameMapper = Object.keys(tsConfigPaths).reduce(
  (acc, key) => {
    const prop = '^' + key.replace('/*', '/(.*)') + '$';
    acc[prop] = '<rootDir>/' + tsConfigPaths[key][0].replace('/*', '/$1');
    return acc;
  },
  // sourced from https://kulshekhar.github.io/ts-jest/docs/guides/esm-support/#esm-presets
  { '^(\\.{1,2}/.*)\\.js$': '$1' }
);

module.exports = {
  verbose: true,
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
      useESM: true,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.js'],
  testMatch: ['**/*.spec.ts', '**/sqlite/**/*.it.ts'],
  testPathIgnorePatterns: ['node_modules', 'dist'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules', 'test'],
  modulePathIgnorePatterns: ['dist'],
  moduleNameMapper,
};
