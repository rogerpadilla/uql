import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseArgs } from './cli.js';
import { createProject, ENTITY, removeProjects } from './test-helpers.js';

const BIN = fileURLToPath(new URL('./bin.ts', import.meta.url));

/**
 * Runs the real CLI, whose contract is the exit code and the two streams: `bun` because the source is
 * TypeScript, which is also how a consumer runs it before the package is built.
 */
const cli = (args: readonly string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile('bun', [BIN, ...args], (error, stdout, stderr) => {
      resolve({ code: Number(error?.code ?? 0), stdout, stderr });
    });
  });

const UNRESOLVABLE = `declare function Field(opts?: { type?: unknown }): PropertyDecorator;

export class Bad {
  @Field() payload?: { nested: true };
}
`;

afterAll(removeProjects);

describe('parseArgs', () => {
  it('defaults to the config in the working directory, writing for real', () => {
    expect(parseArgs([])).toEqual({
      options: { project: 'tsconfig.json', dryRun: false, include: undefined },
      errors: [],
    });
  });

  it('reads every flag it accepts', () => {
    expect(parseArgs(['--project=app/tsconfig.json', '--include=entities,models', '--dry-run'])).toEqual({
      options: { project: 'app/tsconfig.json', dryRun: true, include: ['entities', 'models'] },
      errors: [],
    });
  });

  /** A misspelled `--dry-run` used to be ignored, which turned a preview into a real rewrite. */
  it('rejects an argument it does not know instead of ignoring it', () => {
    expect(parseArgs(['--dryRun']).errors).toEqual(["unknown argument '--dryRun'"]);
    expect(parseArgs(['-d']).errors).toEqual(["unknown argument '-d'"]);
    expect(parseArgs(['--dryRun']).options.dryRun).toBe(false);
  });

  /** Only `--flag=value` is read, so the space form must be an error and not a silent default. */
  it('rejects a value flag given no value', () => {
    expect(parseArgs(['--project']).errors).toEqual(["'--project' needs a value, as '--project=<value>'"]);
    expect(parseArgs(['--include=']).errors).toEqual(["'--include' needs a value, as '--include=<value>'"]);
    expect(parseArgs(['--project', 'tsconfig.json']).errors).toEqual([
      "'--project' needs a value, as '--project=<value>'",
      "unknown argument 'tsconfig.json'",
    ]);
  });
});

describe('cli', () => {
  it('exits 2 on a bad argument, before writing anything', async () => {
    const { project, entity } = await createProject();

    const { code, stderr } = await cli([`--project=${project}`, '--dryRun']);

    expect(code).toBe(2);
    expect(stderr).toContain("unknown argument '--dryRun'");
    expect(stderr).toContain('usage: uql-codemod');
    expect(await readFile(entity, 'utf8')).toBe(ENTITY);
  }, 20_000);

  /** The likeliest mistake of all, and a stack trace on exit 1 read as "there is work left". */
  it('exits 2 with a readable message when the project cannot be read', async () => {
    const { code, stderr } = await cli(['--project=nope.json']);

    expect(code).toBe(2);
    expect(stderr).toContain("Cannot read file '");
    expect(stderr).not.toContain('at run (');
  }, 20_000);

  it('exits 0 on a dry run and says what would change', async () => {
    const { project, entity } = await createProject();

    const { code, stdout } = await cli([`--project=${project}`, '--dry-run']);

    expect(code).toBe(0);
    expect(stdout).toContain('3 file(s) would change');
    expect(await readFile(entity, 'utf8')).toBe(ENTITY);
  }, 20_000);

  it('exits 1 when something is left for a human, having still rewritten the rest', async () => {
    const { project, entity } = await createProject({ 'bad.ts': UNRESOLVABLE });

    const { code, stdout, stderr } = await cli([`--project=${project}`]);

    expect(code).toBe(1);
    expect(stderr).toContain('needs a decision: ');
    expect(stderr).toContain("cannot infer 'type'");
    expect(stderr).toContain('1 property(ies) left untouched');
    expect(stdout).toContain('file(s) changed');
    expect(await readFile(entity, 'utf8')).toContain('@Field({ type: String }) name?: string;');
  }, 20_000);
});
