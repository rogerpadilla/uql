import { describe, expect, it } from 'vitest';
import { createApi } from '../../http/api.js';
import { NodeSqliteQuerierPool } from '../../sqlite/nodeSqliteQuerierPool.js';
import { f } from '../column.js';
import { defineEntity, defineView, getMeta, isTable } from './definition.js';

const Workspace = defineEntity({ name: 'ViewWorkspace', fields: { id: f.number().autoIncrement() } }).relations(
  (rel) => ({ resources: () => rel.oneToMany(Resource, { mappedBy: (resource) => resource.workspace }) }),
  (workspace) => ({
    resourceCount: () => workspace.resources.count(),
    biggest: () => workspace.resources.max((resource) => resource.bytes),
  }),
);

const Resource = defineEntity({
  name: 'ViewResource',
  fields: {
    id: f.number().autoIncrement(),
    workspaceId: f.number(),
    label: f.string().length(40).nullable().default('x'),
    bytes: f.bigint().onInsert(0n),
    deletedAt: f.date().nullable().softDelete(),
  },
}).relations((rel) => ({
  workspace: () => rel.manyToOne(Workspace, { references: (resource) => resource.workspaceId }),
}));

describe('a view', () => {
  it('should take its columns off its aggregate: a group as its source column, an aggregate as what it answers', () => {
    const Usage = defineView({
      name: 'ViewUsage',
      from: () => Resource,
      aggregate: {
        $group: { workspaceId: true, label: true },
        $select: { total: { $count: '*' }, size: { $sum: { bytes: true } }, mean: { $avg: { bytes: true } } },
      },
    });
    const meta = getMeta(Usage);

    expect(meta.fields).toEqual({
      workspaceId: { name: 'workspaceId', type: Number, references: expect.any(Function) },
      label: { name: 'label', type: String, length: 40, nullable: true },
      total: { name: 'total', type: Number },
      size: { name: 'size', type: BigInt, nullable: true },
      mean: { name: 'mean', type: Number, nullable: true },
    });
    expect(meta.ids).toEqual([]);
    expect(meta.readOnly).toBe(true);
    expect(meta.view?.kind).toBe('aggregate');
  });

  it('should key an aggregate by its groups where none is nullable', () => {
    const Usage = defineView({
      name: 'ViewKeyed',
      from: () => Resource,
      aggregate: { $group: { workspaceId: true }, $select: { total: { $count: '*' } } },
    });

    expect(getMeta(Usage).ids).toEqual(['workspaceId']);
    expect(getMeta(Usage).fields['workspaceId']).toEqual({
      name: 'workspaceId',
      type: Number,
      isId: true,
      references: expect.any(Function),
    });
  });

  it('should read a group through a to-one relation as the field it reaches, which the required join keeps', () => {
    const ByWorkspace = defineView({
      name: 'ViewThrough',
      from: () => Resource,
      aggregate: { $group: { owner: { workspace: { id: true } } }, $select: { total: { $count: '*' } } },
    });

    expect(getMeta(ByWorkspace).fields['owner']).toEqual({
      name: 'owner',
      type: Number,
      isId: true,
      references: expect.any(Function),
    });
    expect(getMeta(ByWorkspace).ids).toEqual(['owner']);
  });

  it("should take a find's columns as its source's, keyed by its source's key where it selects it", () => {
    const Live = defineView({
      name: 'ViewLive',
      from: () => Resource,
      find: { $select: { id: true, label: true }, $where: { label: { $ne: null } } },
    });
    const Labels = defineView({ name: 'ViewLabels', from: () => Resource, find: { $select: { label: true } } });

    expect(getMeta(Live).fields).toEqual({
      id: { name: 'id', type: Number, isId: true, references: expect.any(Function) },
      label: { name: 'label', type: String, length: 40, nullable: true },
    });
    expect(getMeta(Live).ids).toEqual(['id']);
    expect(getMeta(Labels).ids).toEqual([]);
  });

  it('should take a relation aggregate a find selects as what it answers', () => {
    const Sized = defineView({
      name: 'ViewSized',
      from: () => Workspace,
      find: { $select: { id: true, resourceCount: true, biggest: true } },
    });

    expect(getMeta(Sized).fields).toEqual({
      id: { name: 'id', type: Number, isId: true, references: expect.any(Function) },
      resourceCount: { name: 'resourceCount', type: Number },
      biggest: { name: 'biggest', type: BigInt, nullable: true },
    });
  });

  it('should keep the entity a column holds the key of: its source, or one its source references', () => {
    const Owned = defineView({
      name: 'ViewOwned',
      from: () => Resource,
      find: { $select: { id: true, workspaceId: true } },
    });
    const ByOwner = defineView({
      name: 'ViewByOwner',
      from: () => Resource,
      aggregate: {
        $group: { owner: { workspace: { id: true } } },
        $select: { first: { $min: { id: true } }, summed: { $sum: { id: true } } },
      },
    });

    expect(getMeta(Owned).fields['id']?.references?.()).toBe(Resource);
    expect(getMeta(Owned).fields['workspaceId']?.references?.()).toBe(Workspace);
    expect(getMeta(ByOwner).fields['owner']?.references?.()).toBe(Workspace);
    expect(getMeta(ByOwner).fields['first']?.references?.()).toBe(Resource);
    expect(getMeta(ByOwner).fields['summed']?.references).toBeUndefined();
  });

  it('should take a find with no $select as every column its source reads by default', () => {
    const Every = defineView({ name: 'ViewEvery', from: () => Resource, find: { $where: { id: { $gt: 1 } } } });

    expect(Object.keys(getMeta(Every).fields)).toEqual(['id', 'workspaceId', 'label', 'bytes', 'deletedAt']);
  });

  it('should leave a view out of the tables', () => {
    const Plain = defineView({ name: 'ViewPlain', from: () => Resource, find: { $select: { id: true } } });

    expect(isTable(Plain)).toBe(false);
    expect(isTable(Resource)).toBe(true);
  });

  it('should refuse a view as a base, whose rows no table holds', () => {
    const Live = defineView({ name: 'ViewLive2', from: () => Resource, find: { $select: { id: true } } });
    const Kid = defineEntity({ name: 'ViewKid', extends: Live, fields: { note: f.string() } });

    expect(() => getMeta(Kid)).toThrow("'ViewKid' extends 'ViewLive2', a view: an entity extends an entity");
  });

  it('should refuse a write as to a view', async () => {
    const Written = defineView({ name: 'ViewWritten', from: () => Resource, find: { $select: { id: true } } });
    const pool = new NodeSqliteQuerierPool(':memory:');

    // @ts-expect-error a view takes no write, which the querier refuses for an untyped caller too
    await expect(pool.insertOne(Written, { id: 1 })).rejects.toThrow("'ViewWritten' is a view, so it is read-only");
    await pool.end();
  });

  it('should take reads alone over the wire', async () => {
    const Wired = defineView({ name: 'ViewWired', from: () => Resource, find: { $select: { id: true } } });
    const api = createApi({ pool: new NodeSqliteQuerierPool(':memory:'), include: [Wired] });

    await expect(api.call({ entity: 'view-wired', op: 'insertOne', payload: { id: 1 } }, undefined)).rejects.toThrow(
      "'ViewWired' cannot be inserted through this API",
    );
  });
});
