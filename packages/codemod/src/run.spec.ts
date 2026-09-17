import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from './index.js';
import { createProject, ENTITY, removeProjects, TSCONFIG } from './test-helpers.js';

afterAll(removeProjects);

describe('run', () => {
  it('rewrites the sources and the config together', async () => {
    const { project, entity } = await createProject();

    const summary = await run({ project });

    expect(summary.changed).toContain(entity);
    expect(summary.changed).toContain(project);
    expect(summary.unresolved).toEqual([]);
    expect(await readFile(entity, 'utf8')).toContain('@Field({ type: String }) name?: string;');
    expect(await readFile(project, 'utf8')).not.toContain('experimentalDecorators');
    expect(await readFile(project, 'utf8')).toContain('"target": "es2024"');
  });

  it('reports the same changes on a dry run without touching a file', async () => {
    const { project, entity } = await createProject();

    const summary = await run({ project, dryRun: true });

    expect(summary.changed).toContain(entity);
    expect(summary.changed).toContain(project);
    expect(await readFile(entity, 'utf8')).toBe(ENTITY);
    expect(await readFile(project, 'utf8')).toBe(TSCONFIG);
  });

  it('restricts the run to the included sources, and still reports the config', async () => {
    const { project, entity, other } = await createProject();

    const summary = await run({ project, dryRun: true, include: ['entities.ts'] });

    expect(summary.changed).toEqual([entity, project]);
    expect(summary.changed).not.toContain(other);
  });
});
