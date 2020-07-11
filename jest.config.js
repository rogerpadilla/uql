// eslint-disable-next-line @typescript-eslint/no-var-requires
const tsPathAliases = require('./tsconfig.json').compilerOptions.paths;

module.exports = {
  verbose: true,
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/config/test-setup-after-env.js'],
  roots: ['<rootDir>/packages'],
  testMatch: ['**/*.spec.ts'],
  collectCoverage: true,
  coverageReporters: ['html', 'text-summary'],
  coverageDirectory: 'coverage',
  moduleNameMapper: Object.keys(tsPathAliases).reduce((acc, key) => {
    const prop = '^' + key.replace('/*', '/(.*)$');
    acc[prop] = '<rootDir>/' + tsPathAliases[key][0].replace('/*', '/$1');
    return acc;
  }, {}),
};
