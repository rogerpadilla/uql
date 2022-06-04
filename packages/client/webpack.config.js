import { resolve } from 'node:path';
import ResolveTypeScriptPlugin from 'resolve-typescript-plugin';

import tsconfig from '../../tsconfig.json' assert { type: 'json' };

const tsPathAliases = tsconfig.compilerOptions.paths;
const entryName = 'uql-client.min';
const outDir = 'dist';
const mode = process.env.NODE_ENV ?? 'development';
const isProductionMode = mode === 'production';
console.debug('*** mode', mode);

export default {
  mode,
  profile: true,
  bail: isProductionMode,
  devtool: isProductionMode ? 'source-map' : 'cheap-module-source-map',

  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
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
        test: /\.tsx?$/,
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
    acc[prop] = resolve('../../', val);
    return acc;
  }, {});
}
