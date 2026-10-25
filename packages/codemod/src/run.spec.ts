import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from './index.js';
import { createProject, ENTITY, removeProjects, TSCONFIG } from './test-helpers.js';

afterAll(removeProjects);

const LEGACY_REPORT = "remove 'experimentalDecorators' and 'emitDecoratorMetadata' by hand";

describe('run', () => {
  it('rewrites the sources, and reports the config it never writes', async () => {
    const { project, entity } = await createProject();

    const summary = await run({ project });

    expect(summary.changed).toContain(entity);
    expect(summary.changed).not.toContain(project);
    expect(summary.unresolved).toHaveLength(3);
    expect(summary.unresolved).toContainEqual(expect.stringContaining(LEGACY_REPORT));
    expect(await readFile(entity, 'utf8')).toContain('@Field() name?: string | null;');
    expect(await readFile(project, 'utf8')).toBe(TSCONFIG);
  });

  it('reports the same changes on a dry run without touching a file', async () => {
    const { project, entity } = await createProject();

    const summary = await run({ project, dryRun: true });

    expect(summary.changed).toContain(entity);
    expect(summary.changed).not.toContain(project);
    expect(await readFile(entity, 'utf8')).toBe(ENTITY);
    expect(await readFile(project, 'utf8')).toBe(TSCONFIG);
  });

  it('restricts the run to the included sources, and still reports the config', async () => {
    const { project, entity, other } = await createProject();

    const summary = await run({ project, dryRun: true, include: ['entities.ts'] });

    expect(summary.changed).toEqual([entity]);
    expect(summary.changed).not.toContain(other);
    expect(summary.unresolved).toHaveLength(2);
    expect(summary.unresolved).toContainEqual(expect.stringContaining(LEGACY_REPORT));
  });
});
