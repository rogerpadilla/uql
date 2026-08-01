import { transform } from 'esbuild';
import { defineConfig } from 'vitest/config';

/**
 * Transforms TypeScript with esbuild, because Oxc (Vite 8's own transformer) implements no decorators
 * at all: it preserves `@Entity()` verbatim at every target, so the suite would run undecorated code.
 *
 * esbuild rather than SWC for two measured reasons. It is the faster of the two on this repo's 359
 * source files (39 ms against 63 ms), and more importantly it is *conformant*: it prototype-chains a
 * subclass's `context.metadata` to its parent's, matching tsc and the Babel reference implementation,
 * where SWC does not do so in any decorator version. uql deliberately does not depend on that chain
 * (inheritance is resolved through the class prototype chain instead), but the tests should still run
 * on the same semantics as the published `dist`, which tsc builds. Babel was measured too and rejected:
 * 14x slower and it fails outright on 14 of these files.
 */
function esbuildTypeScript() {
  return {
    name: 'uql:esbuild-typescript',
    async transform(code: string, id: string) {
      if (!/\.m?ts$/.test(id) || id.includes('node_modules')) {
        return null;
      }
      const result = await transform(code, {
        loader: 'ts',
        target: 'es2025',
        sourcefile: id,
        sourcemap: true,
        tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  oxc: false,
  plugins: [esbuildTypeScript()],
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
        // Argv shims over an exported `run()`, which its own spec covers.
        'packages/*/src/bin.ts',
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
