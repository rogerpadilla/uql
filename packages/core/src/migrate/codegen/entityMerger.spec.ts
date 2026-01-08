import { describe, expect, it } from 'vitest';
import type { ColumnNode, TableNode } from '../../schema/types.js';
import { createEntityMerger, EntityMerger } from './entityMerger.js';

function mockColumn(name: string, category = 'string', overrides: Partial<ColumnNode> = {}): ColumnNode {
  return {
    name,
    type: { category } as any,
    nullable: true,
    isPrimaryKey: false,
    isAutoIncrement: false,
    isUnique: false,
    referencedBy: [],
    ...overrides,
  } as ColumnNode;
}

describe('EntityMerger', () => {
  describe('constructor', () => {
    it('should create instance with default options', () => {
      const merger = new EntityMerger();
      expect(merger).toBeDefined();
    });

    it('should accept custom options', () => {
      const merger = new EntityMerger({
        addSyncComments: false,
        markRemovedAsDeprecated: true,
      });
      expect(merger).toBeDefined();
    });
  });

  describe('merge', () => {
    it('should add a new column field to an empty entity', () => {
      const merger = new EntityMerger();
      const existingCode = `
import { Entity, Id, Field } from '@uql/core';

@Entity()
export class User {
  @Id()
  id?: number;
}
`;
      const col = mockColumn('email', 'string', { nullable: false, type: { category: 'string', length: 255 } as any });
      const result = merger.merge(existingCode, [{ column: col, propertyName: 'email' }]);

      expect(result.modified).toBe(true);
      expect(result.fieldsAdded).toBe(1);
      expect(result.code).toContain("@Field({ columnType: 'varchar', length: 255 })");
      expect(result.code).toContain('email: string;');
      expect(result.code).toContain('@sync-added');
    });

    it('should skip duplicate fields', () => {
      const merger = new EntityMerger();
      const existingCode = `
@Entity()
export class User {
  @Field()
  email?: string;
}
`;
      const col = mockColumn('email', 'string');
      const result = merger.merge(existingCode, [{ column: col, propertyName: 'email' }]);

      expect(result.modified).toBe(false);
      expect(result.fieldsAdded).toBe(0);
      expect(result.code).toBe(existingCode);
    });

    it('should mark fields as deprecated', () => {
      const merger = new EntityMerger({ markRemovedAsDeprecated: true });
      const existingCode = `
@Entity()
export class User {
  @Field()
  oldField?: string;
}
`;
      const result = merger.merge(existingCode, [], [{ propertyName: 'oldField', reason: 'Field removed from DB' }]);

      expect(result.modified).toBe(true);
      expect(result.fieldsDeprecated).toBe(1);
      expect(result.code).toContain('@deprecated Field removed from DB');
      expect(result.code).toContain('@sync-removed');
    });

    it('should add a relation field', () => {
      const merger = new EntityMerger();
      const existingCode = `
@Entity()
export class Post {
  @Id()
  id?: number;
}
`;
      const authorTable: TableNode = { name: 'users', columns: new Map(), primaryKey: [] } as any;
      const postTable: TableNode = { name: 'posts', columns: new Map(), primaryKey: [] } as any;

      const rel = {
        name: 'fk_posts_authors',
        type: 'ManyToOne',
        from: { table: postTable, columns: [mockColumn('author_id')] },
        to: { table: authorTable, columns: [mockColumn('id')] },
      } as any;

      const col = mockColumn('author_id');
      const result = merger.merge(existingCode, [
        { column: col, propertyName: 'author', isRelation: true, relation: rel },
      ]);

      expect(result.modified).toBe(true);
      expect(result.fieldsAdded).toBe(1);
      expect(result.code).toContain('@ManyToOne({ entity: () => User })');
      expect(result.code).toContain('author?: Relation<User>;');
    });

    it('should return unmodified code if class is not found', () => {
      const merger = new EntityMerger();
      const existingCode = 'const x = 1;';
      const result = merger.merge(existingCode, [{ column: mockColumn('email'), propertyName: 'email' }]);
      expect(result.modified).toBe(false);
      expect(result.code).toBe(existingCode);
    });

    it('should build field options for decimals', () => {
      const merger = new EntityMerger();
      const existingCode = `@Entity() export class T { @Id() id?: number; }`;
      const col = mockColumn('price', 'decimal', { type: { category: 'decimal', precision: 10, scale: 2 } as any });

      const result = merger.merge(existingCode, [{ column: col, propertyName: 'price' }]);
      expect(result.code).toContain('precision: 10, scale: 2');
    });

    it('should add an Id field', () => {
      const merger = new EntityMerger();
      const existingCode = `@Entity() export class User { }`;
      const col = mockColumn('id', 'integer', { isPrimaryKey: true });

      const result = merger.merge(existingCode, [{ column: col, propertyName: 'id' }]);
      expect(result.code).toContain('@Id()');
    });

    it('should add an inverse relation field', () => {
      const merger = new EntityMerger();
      const existingCode = `@Entity() export class User { @Id() id?: number; }`;
      const userTable: TableNode = { name: 'users', columns: new Map(), primaryKey: [] } as any;
      const postTable: TableNode = { name: 'posts', columns: new Map(), primaryKey: [] } as any;

      const rel = {
        name: 'fk_posts_authors',
        type: 'ManyToOne',
        from: { table: postTable, columns: [mockColumn('author_id')] },
        to: { table: userTable, columns: [mockColumn('id')] },
      } as any;

      const col = mockColumn('id'); // Not in 'from', so inverse
      const result = merger.merge(existingCode, [
        { column: col, propertyName: 'posts', isRelation: true, relation: rel },
      ]);

      expect(result.code).toContain('@OneToMany({ entity: () => Post })');
      expect(result.code).toContain('posts?: Relation<Post[]>;');
    });

    it('should use default property name transformer', () => {
      const merger = new EntityMerger();
      const existingCode = `@Entity() export class User { @Id() id?: number; }`;
      const col = mockColumn('full_name');

      const result = merger.merge(existingCode, [{ column: col, propertyName: 'fullName' }]);
      expect(result.code).toContain('fullName?: string;');
    });
  });

  describe('createEntityMerger', () => {
    it('should create merger via factory function', () => {
      const merger = createEntityMerger();
      expect(merger).toBeDefined();
    });
  });
});
