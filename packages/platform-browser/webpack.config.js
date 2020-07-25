/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

const parentDir = '../../';
const tsPathAliases = require(`${parentDir}tsconfig.json`).compilerOptions.paths;
const entryName = 'onql-browser.min';

module.exports = (env, argv) => {
  const mode = argv.mode || 'development';
  console.debug('*** Webpack mode', mode);

  return {
    mode,

    devtool: 'source-map',

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
        main: rootDir + '/dist/**/*.d.ts',
        out: rootDir + `/dist/${entryName}.d.ts`,
        outputAsModuleFolder: true,
        exclude: /^core\//,
      });

      rimraf('dist/{core,platform-browser}', {}, (err) => {
        if (err) {
          console.warn(err);
        }
      });
    });
  }
}
