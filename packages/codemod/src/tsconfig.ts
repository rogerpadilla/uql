import ts from 'typescript';
import { propertyAssignment, propertyValue } from './syntax.js';

/** The flags the standard spec has no use for. Their presence is what keeps a project on the old one. */
const LEGACY_FLAGS = ['experimentalDecorators', 'emitDecoratorMetadata'];

/**
 * What a `tsconfig.json` needs decided by hand for the standard decorator spec. The file is only read, never
 * written: its flags are the project's to remove, and a rewrite would have to keep its comments and formatting.
 */
export function checkTsconfig(fileName: string, text: string): readonly string[] {
  const source = ts.parseJsonText(fileName, text);
  const root = source.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) {
    return [`${fileName}: not an object, so nothing was checked`];
  }

  const unresolved: string[] = [];
  const compilerOptions = propertyValue(root, 'compilerOptions');
  const options = compilerOptions && ts.isObjectLiteralExpression(compilerOptions) ? compilerOptions : undefined;
  const legacy = LEGACY_FLAGS.filter((flag) => options && propertyAssignment(options, flag));

  if (legacy.length) {
    unresolved.push(
      `${fileName}: remove ${legacy.map((flag) => `'${flag}'`).join(' and ')} by hand, ` +
        'since the standard spec is the only one uql-orm supports',
    );
  }

  // `target` is only reported: removing it silently falls back to the compiler default (`es5` for `tsc`), and
  // choosing a replacement means guessing which era the project targets.
  const target = options && propertyValue(options, 'target');
  if (target && ts.isStringLiteral(target) && target.text.toLowerCase() === 'esnext') {
    unresolved.push(
      `${fileName}: 'target' is 'esnext', the one target that emits decorator syntax untransformed. ` +
        'Change it to any dated target, such as `es2024`.',
    );
  }

  // A value the file inherits cannot be edited here, and silence would read as "there was none".
  if (propertyValue(root, 'extends') && !legacy.length) {
    unresolved.push(
      `${fileName}: extends another config, so check the base for 'experimentalDecorators', ` +
        "'emitDecoratorMetadata' and 'target'.",
    );
  }

  return unresolved;
}
