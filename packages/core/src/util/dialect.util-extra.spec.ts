import { Entity, Field, getMeta, Id, OneToMany } from '../entity/index.js';
import { QueryRaw } from '../type/index.js';
import {
  buildSortMap,
  buldQueryWhereAsMap,
  fillOnFields,
  filterFieldKeys,
  filterPersistableRelationKeys,
  filterRelationKeys,
  getFieldCallbackValue,
  isCascadable,
  isSelectingRelations,
} from './dialect.util.js';

@Entity()
class DialectUser {
  @Id() id?: number;
  @Field({ updatable: false }) readonlyProp?: string;
  @Field({ virtual: new QueryRaw('1') }) virtualProp?: string;
  @Field({ onInsert: () => 'inserted', onUpdate: 'updated' }) callbackProp?: string;
  @OneToMany({ entity: () => DialectPost, mappedBy: 'user', cascade: true }) posts?: DialectPost[];
}

@Entity()
class DialectPost {
  @Id() id?: number;
  @Field() user?: DialectUser;
}

describe('dialect.util', () => {
  const meta = getMeta(DialectUser);

  it('filterFieldKeys should filter virtual and non-updatable keys', () => {
    const payload = { id: 1, readonlyProp: 'val', virtualProp: 'val', other: 'val' } as DialectUser;
    const insertKeys = filterFieldKeys(meta, payload, 'onInsert');
    expect(insertKeys).toContain('readonlyProp');
    expect(insertKeys).not.toContain('virtualProp');

    const updateKeys = filterFieldKeys(meta, payload, 'onUpdate');
    expect(updateKeys).not.toContain('readonlyProp');
    expect(updateKeys).not.toContain('virtualProp');
  });

  it('getFieldCallbackValue should handle functions and constants', () => {
    expect(getFieldCallbackValue(() => 'test')).toBe('test');
    expect(getFieldCallbackValue('constant')).toBe('constant');
  });

  it('fillOnFields should populate callback fields', () => {
    const payload = { id: 1 } as DialectUser;
    const filled = fillOnFields(meta, { ...payload }, 'onInsert');
    expect(filled[0].callbackProp).toBe('inserted');

    const updated = fillOnFields(meta, { ...payload }, 'onUpdate');
    expect(updated[0].callbackProp).toBe('updated');
  });

  it('isCascadable should check action', () => {
    expect(isCascadable('persist', true)).toBe(true);
    expect(isCascadable('persist', false)).toBe(false);
    expect(isCascadable('persist', 'persist')).toBe(true);
    expect(isCascadable('persist', 'delete')).toBe(false);
  });

  it('filterPersistableRelationKeys should filter by cascade', () => {
    const payload = { posts: [] } as DialectUser;
    const keys = filterPersistableRelationKeys(meta, payload, 'persist');
    expect(keys).toContain('posts');
  });

  it('filterRelationKeys should return relation keys from select', () => {
    const select = { id: true, posts: true } as import('../type/index.js').QuerySelect<DialectUser>;
    const keys = filterRelationKeys(meta, select);
    expect(keys).toContain('posts');
    expect(keys).not.toContain('id');
  });

  it('isSelectingRelations should check if any relation is selected', () => {
    expect(isSelectingRelations(meta, { posts: true } as any)).toBe(true);
    expect(isSelectingRelations(meta, { id: true } as any)).toBe(false);
  });

  it('buildSortMap should handle arrays and objects', () => {
    expect(buildSortMap({ id: 1 } as any)).toEqual({ id: 1 });
    expect(buildSortMap([['id', 1], { field: 'id', sort: -1 }] as any)).toEqual({ id: -1 });
  });

  it('buldQueryWhereAsMap should handle various types', () => {
    expect(buldQueryWhereAsMap(meta, 123)).toEqual({ id: 123 });
    expect(buldQueryWhereAsMap(meta, [1, 2])).toEqual({ id: [1, 2] });
    const raw = new QueryRaw('test');
    expect(buldQueryWhereAsMap(meta, raw)).toEqual({ $and: [raw] });
    expect(buldQueryWhereAsMap(meta, { id: 1 } as any)).toEqual({ id: 1 });
  });
});
