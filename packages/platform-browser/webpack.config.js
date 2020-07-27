/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

const parentDir = '../../';
const tsPathAliases = require(`${parentDir}tsconfig.json`).compilerOptions.paths;
const entryName = 'onql-platform-browser.min';
const outDir = 'dist';

module.exports = (env, argv) => {
  const mode = argv.mode || 'development';
  console.debug('*** Webpack mode', mode);
  const isDevMode = mode === 'development';

  return {
    mode,

    devtool: isDevMode ? 'cheap-module-eval-source-map' : 'source-map',

    resolve: {
      extensions: ['.ts', '.js'],
      alias: Object.keys(tsPathAliases).reduce((acc, key) => {
        const prop = key.replace('/*', '');
        const val = tsPathAliases[key][0].replace('/*', '');
        acc[prop] = path.resolve(parentDir, val);
        return acc;
      }, {}),
    },

    entry: {
      [entryName]: ['./src/index.ts'],
    },

    output: {
      path: path.resolve(outDir),
      publicPath: '/',
      filename: '[name].js',
      chunkFilename: '[id].chunk.js',
      library: 'onql',
      libraryTarget: 'umd',
    },

    module: {
      rules: [
        {
          test: /\.js$/,
          loader: 'source-map-loader',
          enforce: 'pre',
        },
        {
          test: /\.ts$/,
          loader: 'ts-loader',
        },
      ],
    },

    plugins: [new DtsBundlePlugin()],
  };
};

class DtsBundlePlugin {
  apply(compiler) {
    compiler.plugin('done', () => {
      const rootDir = path.resolve(__dirname);
      const dts = require('dts-bundle');
      const rimraf = require('rimraf');

      dts.bundle({
        name: 'onql',
        main: `${rootDir}/${outDir}/platform-browser/**/*.d.ts`,
        out: `${rootDir}/${outDir}/${entryName}.d.ts`,
        outputAsModuleFolder: true,
      });

      rimraf(`${outDir}/{core,platform-browser}`, {}, (err) => {
        if (err) {
          console.error(err);
        }
      });
    });
  }
}
