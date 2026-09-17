import type { RunOptions } from './index.js';

const VALUE_FLAGS = new Set(['project', 'include']);

export type ParsedArgs = {
  readonly options: RunOptions;
  /** Why the arguments were rejected. Nothing runs while this is non-empty. */
  readonly errors: readonly string[];
};

/**
 * Reads the command line, rejecting anything it does not recognise.
 *
 * Unknown arguments are an error rather than being ignored: a misspelled `--dry-run` would otherwise
 * rewrite the project for real, which is the one mistake this tool must not let someone make quietly.
 * Only the `--flag=value` form is accepted, so a stray `--project foo` cannot silently fall back to the
 * default config either.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const errors: string[] = [];
  const values = new Map<string, string>();
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const separator = arg.indexOf('=');
    const name = arg.slice(2, separator === -1 ? undefined : separator);
    if (!arg.startsWith('--') || !VALUE_FLAGS.has(name)) {
      errors.push(`unknown argument '${arg}'`);
      continue;
    }
    const value = arg.slice(separator + 1);
    if (separator === -1 || !value) {
      errors.push(`'--${name}' needs a value, as '--${name}=<value>'`);
      continue;
    }
    values.set(name, value);
  }

  return {
    options: {
      project: values.get('project') ?? 'tsconfig.json',
      dryRun,
      include: values.get('include')?.split(',').filter(Boolean),
    },
    errors,
  };
}
