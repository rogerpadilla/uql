/* eslint-disable import/no-extraneous-dependencies */
import * as path from 'path';
import * as webpack from 'webpack';
import * as CopyPlugin from 'copy-webpack-plugin';
import * as ForkTsCheckerPlugin from 'fork-ts-checker-webpack-plugin';

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
      'corozo.min': ['./src/index.ts', './src/http/index.ts'],
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
      new CopyPlugin({ patterns: ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'] }) as any,
      new ForkTsCheckerPlugin({
        eslint: true,
      }),
    ],
  };
};

export default config;
