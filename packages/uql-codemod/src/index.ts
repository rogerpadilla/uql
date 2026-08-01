import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { type FileResult, transformFile } from './transform.js';
import { transformTsconfig } from './tsconfig.js';

export * from './transform.js';
export * from './tsconfig.js';

export type RunOptions = {
  /** Path to the project's `tsconfig.json`; the codemod needs a real program to read property types. */
  readonly project: string;
  /** Report what would change without touching anything. */
  readonly dryRun?: boolean;
  /** Restrict the run to files whose path contains one of these fragments. */
  readonly include?: readonly string[];
};

export type RunSummary = {
  readonly changed: readonly string[];
  readonly unresolved: readonly string[];
  readonly notes: readonly string[];
};

/**
 * Rewrites a project's entities for the standard decorator spec.
 *
 * @remarks Needs a type checker, not just a parser: the whole point is to write down the types that
 * `design:type` used to report at runtime, and only the checker knows what `role?: Role` resolves to.
 */
export async function run({ project, dryRun, include }: RunOptions): Promise<RunSummary> {
  // Absolute, because `parseJsonConfigFileContent` resolves every discovered file against the base path
  // and a relative one yields file names the program cannot then open.
  const configPath = resolve(project);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new TypeError(ts.flattenDiagnosticMessageText(config.error.messageText, ' '));
  }
  const host = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const program = ts.createProgram(host.fileNames, {
    ...host.options,
    // The codemod only ever reads types, so the emit target is irrelevant. It is pinned because a
    // project may name a target newer than this TypeScript understands, which would otherwise be
    // reported as a config error and leave the options half-applied.
    target: ts.ScriptTarget.ESNext,
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  const results: FileResult[] = [];
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || /[/\\]node_modules[/\\]/.test(source.fileName)) continue;
    if (include?.length && !include.some((fragment) => source.fileName.includes(fragment))) continue;
    const result = transformFile(source, checker);
    if (result.changed || result.unresolved.length || result.notes.length) results.push(result);
  }

  // The config is rewritten too: leaving `experimentalDecorators` on is what keeps a project compiling
  // against the old spec, so a codemod that only touched the sources would leave it half-migrated.
  const tsconfig = transformTsconfig(configPath, ts.sys.readFile(configPath) ?? '');

  if (!dryRun) {
    await Promise.all(results.filter((r) => r.changed).map((r) => writeFile(r.fileName, r.text, 'utf8')));
    if (tsconfig.changed) {
      await writeFile(configPath, tsconfig.text, 'utf8');
    }
  }

  return {
    changed: [...results.filter((r) => r.changed).map((r) => r.fileName), ...(tsconfig.changed ? [configPath] : [])],
    unresolved: [...results.flatMap((r) => r.unresolved), ...tsconfig.unresolved],
    notes: results.flatMap((r) => r.notes),
  };
}
