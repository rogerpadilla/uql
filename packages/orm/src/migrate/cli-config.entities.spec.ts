import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import { loadConfig } from './cli-config.js';

const entityPath = path.resolve(process.cwd(), 'uqlConfigProbeEntity.ts');
const configPath = path.resolve(process.cwd(), 'uqlConfigProbe.config.ts');

afterEach(async () => {
  await Promise.all([fs.unlink(entityPath).catch(() => {}), fs.unlink(configPath).catch(() => {})]);
});

/**
 * Whatever loads the config decides the decorator spec its entity classes are called with, so a wrong
 * one yields empty metadata. An explicit config path: `cli-config.spec.ts` writes `uql.config.ts` into
 * the same cwd concurrently, and a config URL is module-cached.
 */
it('should register decorator metadata for the entities the config imports', async () => {
  await fs.writeFile(
    entityPath,
    `import { Entity, Field, Id } from 'uql-orm';
@Entity()
export class UqlConfigProbe {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}
`,
  );
  await fs.writeFile(
    configPath,
    `import { UqlConfigProbe } from './uqlConfigProbeEntity.js';
export default { pool: { dialect: { dialectName: 'sqlite' } }, entities: [UqlConfigProbe] };
`,
  );

  const config = await loadConfig(path.basename(configPath));
  const entity = config.entities?.[0];
  assertDefined(entity);
  const meta = getMeta(entity);

  expect(entity.name).toBe('UqlConfigProbe');
  expect(meta.name).toBe('UqlConfigProbe');
  expect(meta.ids[0]).toBe('id');
  expect(Object.keys(meta.fields)).toEqual(['id', 'name']);
});
