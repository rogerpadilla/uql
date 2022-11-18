import tsconfig from './tsconfig.json';

const tsConfigPaths = tsconfig.compilerOptions.paths;

const moduleNameMapper = Object.keys(tsConfigPaths).reduce((acc, key) => {
  const prop = '^' + key.replace('/*', '/(.*)') + '$';
  acc[prop] = '<rootDir>/' + tsConfigPaths[key][0].replace('/*', '/$1');
  return acc;
}, {});

module.exports = {
  verbose: true,
  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
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
  moduleNameMapper,
};
