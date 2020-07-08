/* eslint-disable import/no-extraneous-dependencies */
import * as path from 'path';
import * as webpack from 'webpack';
import CopyPlugin from 'copy-webpack-plugin';
import ForkTsCheckerPlugin from 'fork-ts-checker-webpack-plugin';

const config = (env: string, argv: { mode: 'development' | 'production' | 'none' }): webpack.Configuration => {
  const mode = argv.mode || 'development';
  console.debug('*** Webpack mode', mode);
  const isDevMode = mode === 'development';

  return {
    mode,

    devtool: isDevMode ? 'cheap-module-eval-source-map' : 'source-map',

    resolve: {
      extensions: ['.ts', '.js'],
    },

    entry: {
      'corozo.min': ['./packages/core/src/type/index.ts', './packages/browser/src/index.ts'],
    },

    output: {
      path: path.resolve('dist'),
      publicPath: '/',
      filename: '[name].js',
      chunkFilename: '[id].chunk.js',
      library: 'corozo',
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
          options: {
            transpileOnly: true,
          },
        },
      ],
    },

    plugins: [
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      new CopyPlugin({ patterns: ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'] }) as any,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      new ForkTsCheckerPlugin(),
    ],
  };
};

export default config;
