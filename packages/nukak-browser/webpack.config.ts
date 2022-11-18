/* eslint-disable @typescript-eslint/no-var-requires */
import { resolve } from 'node:path';
import { Compiler, Configuration } from 'webpack';
import ResolveTypeScriptPlugin from 'resolve-typescript-plugin';
import tsconfig from '../../tsconfig.json' assert { type: 'json' };

const parentDir = '../../';
const tsPathAliases = tsconfig.compilerOptions.paths;
const entryName = 'nukak-browser.min';
const outDir = 'dist';
type Mode = 'development' | 'production';
const mode = (process.env.NODE_ENV as Mode) ?? 'development';
const isProductionMode = mode === 'production';
console.debug('*** mode', mode);

const config: Configuration = {
  mode,
  profile: true,
  bail: isProductionMode,
  devtool: isProductionMode ? 'source-map' : 'cheap-module-source-map',

  resolve: {
    extensions: ['.ts', '.js'],
    alias: buildAlias(),
    plugins: [new ResolveTypeScriptPlugin()],
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
};

function buildAlias() {
  return Object.keys(tsPathAliases).reduce((acc, key) => {
    const prop = key.replace('/*', '');
    const val = tsPathAliases[key][0].replace('/*', '');
    acc[prop] = resolve(parentDir, val);
    return acc;
  }, {});
}

export default config;
