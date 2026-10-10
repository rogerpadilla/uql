import ts from 'typescript';
import { applyEdits, type Edit, removeFromList } from './edits.js';
import { propertyAssignment, propertyValue } from './syntax.js';

/** The flags the standard spec has no use for. Their presence is what keeps a project on the old one. */
const LEGACY_FLAGS = ['experimentalDecorators', 'emitDecoratorMetadata'];

export type TsconfigResult = {
  readonly text: string;
  readonly changed: boolean;
  /** What the codemod will not decide, each needing a human. */
  readonly unresolved: readonly string[];
};

/**
 * Rewrites a `tsconfig.json` for the standard decorator spec, as text through `ts.parseJsonText` rather than
 * re-serialised: a tsconfig is JSON with comments and someone's formatting, which a rewrite would throw away.
 */
export function transformTsconfig(fileName: string, text: string): TsconfigResult {
  const source = ts.parseJsonText(fileName, text);
  const root = source.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) {
    return { text, changed: false, unresolved: [`${fileName}: not an object, so nothing was changed`] };
  }

  const edits: Edit[] = [];
  const unresolved: string[] = [];
  const compilerOptions = propertyValue(root, 'compilerOptions');

  if (compilerOptions && ts.isObjectLiteralExpression(compilerOptions)) {
    const legacy = LEGACY_FLAGS.flatMap((flag) => {
      const property = propertyAssignment(compilerOptions, flag);
      return property ? [property] : [];
    });
    edits.push(...removeFromList(compilerOptions.properties, legacy, source));

    // `target` is reported, not rewritten: removing it silently falls back to the compiler default
    // (`es5` for `tsc`), and choosing a replacement means guessing which era the project targets.
    const target = propertyValue(compilerOptions, 'target');
    if (target && ts.isStringLiteral(target) && target.text.toLowerCase() === 'esnext') {
      unresolved.push(
        `${fileName}: 'target' is 'esnext', the one target that emits decorator syntax untransformed. ` +
          'Change it to any dated target, such as `es2024`.',
      );
    }
  }

  // A value the file inherits cannot be edited here, and silence would read as "there was none".
  if (propertyValue(root, 'extends') && !edits.length) {
    unresolved.push(
      `${fileName}: extends another config, so check the base for 'experimentalDecorators', ` +
        "'emitDecoratorMetadata' and 'target'.",
    );
  }

  return { text: applyEdits(text, edits), changed: edits.length > 0, unresolved };
}
