/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

const parentDir = '../../';
const tsPathAliases = require(`${parentDir}tsconfig.json`).compilerOptions.paths;
const entryName = 'uql-client.min';
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
      library: 'uql',
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
    compiler.hooks.done.tapAsync('DtsBundlePlugin', () => {
      const rootDir = path.resolve(__dirname);
      const dts = require('dts-bundle');
      const rimraf = require('rimraf');

      dts.bundle({
        name: 'uql',
        main: `${rootDir}/${outDir}/client/**/*.d.ts`,
        out: `${rootDir}/${outDir}/${entryName}.d.ts`,
        outputAsModuleFolder: true,
      });

      rimraf.sync(`${outDir}/{core,client}`);
    });
  }
}
