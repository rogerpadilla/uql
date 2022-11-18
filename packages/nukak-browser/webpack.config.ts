/* eslint-disable @typescript-eslint/no-var-requires */
import { resolve } from 'path';
import { Compiler, Configuration } from 'webpack';

const parentDir = '../../';
const tsPathAliases = require(`${parentDir}tsconfig.json`).compilerOptions.paths;
const entryName = 'nukak-browser.min';
const outDir = 'dist';
type Mode = 'development' | 'production';
const mode = (process.env.NODE_ENV as Mode) ?? 'development';
const isProductionMode = mode === 'production';
console.debug('*** mode', mode);

class DtsBundlePlugin {
  apply(compiler: Compiler) {
    compiler.hooks.done.tapAsync('DtsBundlePlugin', () => {
      const rootDir = resolve(__dirname);
      const dts = require('dts-bundle');
      const rimraf = require('rimraf');

      dts.bundle({
        name: 'nukak',
        main: `${rootDir}/${outDir}/nukak-browser/**/*.d.ts`,
        out: `${rootDir}/${outDir}/${entryName}.d.ts`,
        outputAsModuleFolder: true,
      });

      rimraf.sync(`${outDir}/{core,client}`);
    });
  }
}

const config: Configuration = {
  mode,
  profile: true,
  bail: isProductionMode,
  devtool: isProductionMode ? 'source-map' : 'cheap-module-source-map',

  resolve: {
    extensions: ['.ts', '.js'],
    alias: buildAlias(),
  },

  entry: {
    [entryName]: ['./src/index.ts'],
  },

  output: {
    path: resolve(outDir),
    publicPath: '/',
    filename: '[name].js',
    chunkFilename: '[id].chunk.js',
    library: 'nukak',
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
        exclude: /node_modules/,
      },
    ],
  },

  plugins: [new DtsBundlePlugin()],
};

function buildAlias() {
  return Object.keys(tsPathAliases).reduce((acc, key) => {
    const prop = key.replace('/*', '');
    const val = tsPathAliases[key][0].replace('/*', '');
    acc[prop] = resolve(parentDir, val);
    return acc;
  }, {});
}

module.exports = config;
