import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8 transforms with Oxc, which does not implement decorators at all (verified: it preserves
  // `@Entity()` verbatim at every target). SWC does, so it owns the transform and Oxc's default is
  // turned off here. `unplugin-swc` still sets the pre-Vite-8 `esbuild: false`, which is now a no-op.
  oxc: false,
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
    // `*.bun.test.ts` files assert Bun-only driver behavior and import `bun:test`; see `test:bun`.
    exclude: ['packages/uql-orm/src/bunSql/**/*.test.ts', 'packages/**/*.bun.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'text-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/bunSql/**/*.test.ts',
        'packages/*/src/**/*.spec.ts',
        'packages/*/src/**/*-spec.ts',
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*-test.ts',
        // `*.bun.ts` only ever executes under Bun, so this run cannot reach it; `test:bun` covers it.
        'packages/*/src/**/*.bun.ts',
        'packages/*/src/test/**/*.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/*.d.ts',
        'packages/*/src/type/**/*.ts',
        'packages/*/src/browser/type/**/*.ts',
        'packages/*/src/**/types.ts', // Pure type definition files
      ],
      thresholds: {
        statements: 98,
        branches: 93,
        functions: 99,
        lines: 99,
      },
    },
    css: false,
  },
});
