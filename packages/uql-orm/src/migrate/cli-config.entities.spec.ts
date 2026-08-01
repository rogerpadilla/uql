import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { loadConfig } from './cli-config.js';

const entityPath = path.resolve(process.cwd(), 'uqlConfigProbeEntity.ts');
const configPath = path.resolve(process.cwd(), 'uqlConfigProbe.config.ts');

afterEach(async () => {
  await Promise.all([fs.unlink(entityPath).catch(() => {}), fs.unlink(configPath).catch(() => {})]);
});

/**
 * `config.entities` holds the entity *classes*, so whatever loads the config also decides which
 * decorator spec their decorators are called with. Nothing asserted that before, which is why a loader
 * emitting the wrong spec would have produced silently empty metadata instead of an error.
 *
 * Uses an explicit config path rather than the default `uql.config.ts`, because `cli-config.spec.ts`
 * writes that same filename into the same cwd and the two suites run concurrently. The config URL is
 * also module-cached, so two suites reusing one path would see each other's first version.
 */
it('loadConfig registers decorator metadata for the entities the config imports', async () => {
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
  const meta = getMeta(entity!);

  expect(entity?.name).toBe('UqlConfigProbe');
  expect(meta.name).toBe('UqlConfigProbe');
  expect(meta.id).toBe('id');
  expect(Object.keys(meta.fields)).toEqual(['id', 'name']);
});
