/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

const parentDir = '../../';
const tsPathAliases = require(`${parentDir}tsconfig.json`).compilerOptions.paths;
const entryName = 'onql-platform-browser.min';

module.exports = (env, argv) => {
  const mode = argv.mode || 'development';
  console.debug('*** Webpack mode', mode);

  return {
    mode,

    devtool: 'source-map',

    optimization: {
      minimizer: [
        new TerserPlugin({
          cache: true,
          sourceMap: true,
          terserOptions: {
            keep_fnames: true,
          },
        }),
      ],
    },

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
      path: path.resolve('dist'),
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
        main: rootDir + '/dist/platform-browser/**/*.d.ts',
        out: rootDir + `/dist/${entryName}.d.ts`,
        outputAsModuleFolder: true,
      });

      rimraf('dist/{core,platform-browser}', {}, (err) => {
        if (err) {
          console.warn(err);
        }
      });
    });
  }
}
