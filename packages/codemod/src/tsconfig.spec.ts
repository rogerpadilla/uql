import { describe, expect, it } from 'vitest';
import { checkTsconfig } from './tsconfig.js';

const LEGACY_REPORT =
  "remove 'experimentalDecorators' and 'emitDecoratorMetadata' by hand, since the standard spec is the only one uql-orm supports";

describe('tsconfig', () => {
  it('reports both decorator flags, and leaves the rest of the file to the project', () => {
    const unresolved = checkTsconfig(
      '/tsconfig.json',
      `{
  // Kept as the project wrote it, comments included.
  "compilerOptions": {
    "target": "es2024",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
`,
    );

    expect(unresolved).toEqual([expect.stringContaining(LEGACY_REPORT)]);
  });

  it('names only the flag the config has', () => {
    const unresolved = checkTsconfig(
      '/tsconfig.json',
      `{"compilerOptions":{"strict":true,"emitDecoratorMetadata":true}}`,
    );

    expect(unresolved).toEqual([
      expect.stringContaining(
        "remove 'emitDecoratorMetadata' by hand, since the standard spec is the only one uql-orm supports",
      ),
    ]);
  });

  /**
   * Removing `target` would fall back to the compiler default (`es5`), and picking a replacement means
   * guessing which era the project targets.
   */
  it('reports target esnext rather than choosing a replacement', () => {
    const unresolved = checkTsconfig('/tsconfig.json', `{"compilerOptions":{"target":"ESNext"}}`);

    expect(unresolved).toEqual([expect.stringContaining("'target' is 'esnext'")]);
  });

  it('reports a config it cannot read as not an object', () => {
    const unresolved = checkTsconfig('/tsconfig.json', '// nothing but a comment\n');

    expect(unresolved).toEqual([expect.stringContaining('not an object, so nothing was checked')]);
  });

  it('reports nothing for a config with no compiler options of its own', () => {
    expect(checkTsconfig('/tsconfig.json', `{"include":["src"]}`)).toEqual([]);
  });

  it('points at the base config when the flags are not local', () => {
    const unresolved = checkTsconfig(
      '/tsconfig.json',
      `{"extends":"./tsconfig.base.json","compilerOptions":{"strict":true}}`,
    );

    expect(unresolved).toEqual([expect.stringContaining('extends another config')]);
  });
});
