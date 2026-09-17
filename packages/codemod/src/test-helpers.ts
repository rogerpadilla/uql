import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TSCONFIG = `{
  "compilerOptions": {
    "target": "es2024",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
`;

/**
 * `Field` is declared in the file rather than imported: the codemod builds a real program from the config
 * it is given, and a temporary project cannot resolve `uql-orm` from a directory outside the workspace.
 */
export const ENTITY = `declare function Field(opts?: { type?: unknown }): PropertyDecorator;

export class Item {
  @Field() name?: string;
}
`;

const created: string[] = [];

/**
 * A throwaway project on disk, since `run` and the CLI are the layers that read and write real files.
 * Extra files are written alongside the default `tsconfig.json`, `entities.ts` and `other.ts`.
 */
export async function createProject(extra: Readonly<Record<string, string>> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'uql-codemod-'));
  created.push(dir);
  const files = { 'tsconfig.json': TSCONFIG, 'entities.ts': ENTITY, 'other.ts': ENTITY.replace('name', 'label') };
  await Promise.all(Object.entries({ ...files, ...extra }).map(([name, text]) => writeFile(join(dir, name), text)));
  return { project: join(dir, 'tsconfig.json'), entity: join(dir, 'entities.ts'), other: join(dir, 'other.ts') };
}

export const removeProjects = () => Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
