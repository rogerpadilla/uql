import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
          dynamicImport: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.spec.ts', 'packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'text-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.spec.ts',
        'packages/*/src/**/*.test.ts',
        'packages/*/src/test/**/*.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/*.d.ts',
        'packages/*/src/type/**/*.ts',
        'packages/*/src/browser/type/**/*.ts',
      ],
      thresholds: {
        statements: 99.26,
        branches: 95.15,
        functions: 99.31,
        lines: 99.46,
      },
    },
    pool: 'threads',
  },
});
