import { describe, expect, it } from 'vitest';
import { transformTsconfig } from './tsconfig.js';

describe('tsconfig', () => {
  it('removes both decorator flags and keeps the rest of the file as written', () => {
    const { text, changed, unresolved } = transformTsconfig(
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

    expect(changed).toBe(true);
    expect(text).not.toContain('experimentalDecorators');
    expect(text).not.toContain('emitDecoratorMetadata');
    expect(text).toContain('// Kept as the project wrote it, comments included.');
    expect(text).toContain('"target": "es2024"');
    expect(text).toContain('"strict": true');
    expect(unresolved).toEqual([]);
    expect(JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))).toEqual({
      compilerOptions: { target: 'es2024', strict: true },
    });
  });

  it('removes a trailing flag without leaving a dangling comma', () => {
    const { text } = transformTsconfig(
      '/tsconfig.json',
      `{"compilerOptions":{"strict":true,"experimentalDecorators":true}}`,
    );

    expect(JSON.parse(text)).toEqual({ compilerOptions: { strict: true } });
  });

  /**
   * Removing `target` would fall back to the compiler default (`es5`), and picking a replacement means
   * guessing which era the project targets.
   */
  it('reports target esnext rather than choosing a replacement', () => {
    const { text, unresolved } = transformTsconfig('/tsconfig.json', `{"compilerOptions":{"target":"ESNext"}}`);

    expect(text).toContain('"target":"ESNext"');
    expect(unresolved[0]).toContain("'target' is 'esnext'");
  });

  it('leaves a config it cannot read as it found it', () => {
    const { text, changed, unresolved } = transformTsconfig('/tsconfig.json', '// nothing but a comment\n');

    expect(text).toBe('// nothing but a comment\n');
    expect(changed).toBe(false);
    expect(unresolved[0]).toContain('not an object, so nothing was changed');
  });

  it('points at the base config when the flags are not local', () => {
    const { changed, unresolved } = transformTsconfig(
      '/tsconfig.json',
      `{"extends":"./tsconfig.base.json","compilerOptions":{"strict":true}}`,
    );

    expect(changed).toBe(false);
    expect(unresolved[0]).toContain('extends another config');
  });
});
