import { expect, it } from 'vitest';
import { metaCore } from '../test-helpers.js';
import { defineEntity, defineField, defineId, defineRelation, getMeta } from './definition.js';

it('defineEntity bulk fields match incremental defineField + defineEntity', () => {
  class Incremental {}
  defineField(Incremental, 'id', { type: Number, isId: true });
  defineField(Incremental, 'title', { type: String, nullable: false });
  defineEntity(Incremental, { name: 'ArticleIncr' });

  class Bulk {}
  defineEntity(Bulk, {
    name: 'ArticleBulk',
    fields: {
      id: { type: Number, isId: true },
      title: { type: String, nullable: false },
    },
  });

  expect(metaCore(Incremental).fields).toEqual(metaCore(Bulk).fields);
  expect(metaCore(Incremental).id).toBe(metaCore(Bulk).id);
});

it('defineEntity bulk relations and FK fields match incremental registration', () => {
  class Target {}
  defineEntity(Target, {
    fields: { id: { type: Number, isId: true } },
  });

  class Incremental {}
  defineField(Incremental, 'id', { type: Number, isId: true });
  defineField(Incremental, 'targetId', { type: Number, references: () => Target });
  defineRelation(Incremental, 'target', { cardinality: 'm1', entity: () => Target });
  defineEntity(Incremental, { name: 'LinkedRow' });

  class Bulk {}
  defineEntity(Bulk, {
    name: 'LinkedRow',
    fields: {
      id: { type: Number, isId: true },
      targetId: { type: Number, references: () => Target },
    },
    relations: {
      target: { cardinality: 'm1', entity: () => Target },
    },
  });

  const a = metaCore(Incremental);
  const b = metaCore(Bulk);
  for (const key of ['id', 'targetId'] as const) {
    expect(a.fields[key]?.type).toBe(b.fields[key]?.type);
    expect(a.fields[key]?.isId).toBe(b.fields[key]?.isId);
    const ar = a.fields[key]?.references;
    const br = b.fields[key]?.references;
    if (ar && br) {
      expect(ar()).toBe(br());
    } else {
      expect(ar).toBe(br);
    }
  }
  expect(a.relations?.['target']?.cardinality).toBe(b.relations?.['target']?.cardinality);
  expect(a.relations?.['target']?.references).toEqual(b.relations?.['target']?.references);
  expect(a.relations?.['target']?.entity?.()).toBe(Target);
  expect(b.relations?.['target']?.entity?.()).toBe(Target);
});

it('defineEntity bulk indexes and hooks', () => {
  class Indexed {}
  defineEntity(Indexed, {
    fields: {
      id: { type: Number, isId: true },
      email: { type: String },
      status: { type: String },
    },
    indexes: [
      { columns: ['email', 'status'], name: 'idx_email_status', unique: false },
      { columns: ['email'], unique: true },
    ],
    hooks: {
      beforeInsert: ['stampCreatedAt'],
      afterLoad: ['hydrate'],
    },
  });

  const m = getMeta(Indexed);
  expect(m.indexes).toHaveLength(2);
  expect(m.indexes![0]).toMatchObject({
    columns: ['email', 'status'],
    name: 'idx_email_status',
    unique: false,
  });
  expect(m.indexes![1]).toMatchObject({ columns: ['email'], unique: true });
  expect(m.hooks?.beforeInsert).toEqual([{ methodName: 'stampCreatedAt' }]);
  expect(m.hooks?.afterLoad).toEqual([{ methodName: 'hydrate' }]);
});

it('child class inherits parent fields when parent finalized first', () => {
  class ParentEntity {}
  defineEntity(ParentEntity, {
    fields: {
      id: { type: Number, isId: true },
      baseCol: { type: String },
    },
  });

  class ChildEntity extends ParentEntity {}
  defineEntity(ChildEntity, {
    fields: {
      childCol: { type: Boolean },
    },
  });

  const m = getMeta(ChildEntity);
  expect(m.fields['id']?.isId).toBe(true);
  expect(m.fields['baseCol']?.type).toBe(String);
  expect(m.fields['childCol']?.type).toBe(Boolean);
  expect(m.id).toBe('id');
});

it('defineEntity bulk throws when no id field is declared', () => {
  class MissingId {}
  expect(() =>
    defineEntity(MissingId, {
      fields: { title: { type: String } },
    }),
  ).toThrow(/exactly one id field/);
});

it('defineId path via bulk isId matches defineId helper', () => {
  class A {}
  defineEntity(A, {
    fields: { pk: { type: String, isId: true }, x: { type: Number } },
  });
  class B {}
  defineId(B, 'pk', { type: String });
  defineField(B, 'x', { type: Number });
  defineEntity(B, {});

  expect(getMeta(A).id).toBe('pk');
  expect(getMeta(B).id).toBe('pk');
  expect(getMeta(A).fields).toEqual(getMeta(B).fields);
});
