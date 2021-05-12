// eslint-disable-next-line @typescript-eslint/no-var-requires
const tsPathAliases = require('./tsconfig.json').compilerOptions.paths;

module.exports = {
  verbose: true,
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.js'],
  roots: ['<rootDir>/packages'],
  testMatch: ['**/*.spec.ts', '**/sqlite/**/*.it.ts'],
  testPathIgnorePatterns: ['node_modules', 'dist'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules', 'test'],
  moduleNameMapper: Object.keys(tsPathAliases).reduce((acc, key) => {
    const prop = '^' + key.replace('/*', '/(.*)$');
    acc[prop] = '<rootDir>/' + tsPathAliases[key][0].replace('/*', '/$1');
    return acc;
  }, {}),
};
