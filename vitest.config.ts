import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
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
  resolve: {
    tsconfigPaths: true,
  },
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
        'packages/*/src/**/*-spec.ts',
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*-test.ts',
        'packages/*/src/test/**/*.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/*.d.ts',
        'packages/*/src/type/**/*.ts',
        'packages/*/src/browser/type/**/*.ts',
        'packages/*/src/**/types.ts', // Pure type definition files
      ],
      thresholds: {
        statements: 96.5,
        branches: 90,
        functions: 97.5,
        lines: 97.5,
      },
    },
    pool: 'threads',
    css: false,
  },
});
