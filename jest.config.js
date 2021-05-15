// eslint-disable-next-line @typescript-eslint/no-var-requires
const tsConfigPaths = require('./tsconfig.json').compilerOptions.paths;

const moduleNameMapper = Object.keys(tsConfigPaths).reduce((acc, key) => {
  const prop = '^' + key.replace('/*', '/(.*)') + '$';
  acc[prop] = '<rootDir>/' + tsConfigPaths[key][0].replace('/*', '/$1');
  return acc;
}, {});

module.exports = {
  verbose: true,
  preset: 'ts-jest',
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
