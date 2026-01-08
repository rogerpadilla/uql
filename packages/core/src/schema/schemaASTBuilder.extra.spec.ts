import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToOne } from '../entity/index.js';
import { raw } from '../util/index.js';
import { SchemaASTBuilder } from './schemaASTBuilder.js';

describe('SchemaASTBuilder Extra Coverage', () => {
  it('should default autoIncrement to true for integer PK', () => {
    @Entity()
    class AutoInc {
      @Id()
      id?: number;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([AutoInc]);
    const table = ast.getTable('AutoInc');
    const idCol = table?.columns.get('id');
    expect(idCol?.isAutoIncrement).toBe(true);
  });

  it('should respect explicit autoIncrement false for integer PK', () => {
    @Entity()
    class NoAutoInc {
      @Id({ autoIncrement: false })
      id?: number;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([NoAutoInc]);
    const table = ast.getTable('NoAutoInc');
    const idCol = table?.columns.get('id');
    expect(idCol?.isAutoIncrement).toBe(false);
  });

  it('should generate default index name when index is true', () => {
    @Entity()
    class DefaultIndex {
      @Id() id?: number;
      @Field({ index: true })
      name?: string;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([DefaultIndex]);
    const table = ast.getTable('DefaultIndex');
    const index = table?.indexes.find((i) => i.columns[0].name === 'name');
    expect(index?.name).toBe('idx_DefaultIndex_name');
  });

  it('should default relation references if not provided (Implicit FK)', () => {
    @Entity()
    class Target {
      @Id()
      id?: number;
    }

    @Entity()
    class Source {
      @Id()
      id?: number;

      @Field()
      targetId?: number;

      @ManyToOne({ entity: () => Target })
      target?: Target;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([Target, Source]);
    const rel = ast.relationships.find((r) => r.from.table.name === 'Source');

    expect(rel).toBeDefined();
    expect(rel?.from.columns[0].name).toBe('targetId');
    expect(rel?.to.columns[0].name).toBe('id');
  });

  it('should use explicit references in ManyToOne', () => {
    @Entity()
    class Group {
      @Id() id?: number;
    }

    @Entity()
    class Member {
      @Id() id?: number;

      @Field()
      groupIdKey?: number;

      @ManyToOne({ entity: () => Group, references: [{ local: 'groupIdKey', foreign: 'id' }] })
      group?: Group;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([Group, Member]);
    const rel = ast.relationships.find((r) => r.from.table.name === 'Member');
    expect(rel).toBeDefined();
    expect(rel?.from.columns[0].name).toBe('groupIdKey');
  });

  it('should skip relation if local field is missing', () => {
    @Entity()
    class RelTarget {
      @Id() id?: number;
    }

    @Entity()
    class RelSource {
      @Id() id?: number;

      // 'missingId' field does not exist
      @ManyToOne({ entity: () => RelTarget, references: [{ local: 'missingId', foreign: 'id' }] })
      target?: RelTarget;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([RelTarget, RelSource]);
    // Should have no relationships because local field is missing
    expect(ast.relationships.length).toBe(0);
  });

  it('should skip relation if foreign field is missing', () => {
    @Entity()
    class RelTarget2 {
      @Id() id?: number;
    }

    @Entity()
    class RelSource2 {
      @Id() id?: number;
      @Field() targetId?: number;

      // 'missingId' field does not exist on target
      @ManyToOne({ entity: () => RelTarget2, references: [{ local: 'targetId', foreign: 'missingId' }] })
      target?: RelSource2;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([RelTarget2, RelSource2]);
    expect(ast.relationships.length).toBe(0);
  });

  it('should skip relation if columns are virtual (no columns created)', () => {
    @Entity()
    class VirtualTarget {
      @Id() id?: number;
    }

    @Entity()
    class VirtualSource {
      @Id() id?: number;

      @Field({ virtual: raw('1') })
      targetId?: number;

      @ManyToOne({ entity: () => VirtualTarget, references: [{ local: 'targetId', foreign: 'id' }] })
      target?: VirtualTarget;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([VirtualTarget, VirtualSource]);
    // Relation depends on 'targetId' column, but it is virtual, so no column => no relation in AST
    expect(ast.relationships.length).toBe(0);
  });

  it('should handle missing tables due to unstable resolution (Entity Guards)', () => {
    @Entity()
    class Unstable {
      @Id() id?: number;
      @Field({ index: true }) name?: string;
      @ManyToOne({ entity: () => Unstable }) self?: Unstable;
    }

    let callCount = 0;
    const builder = new SchemaASTBuilder();

    // This resolver returns a different name every time it's called
    // causing the table to be added with name "T1", but looked up as "T2", "T3" etc.
    // This triggers `if (!table) return` in addRelationshipsFromEntity and addIndexesFromEntity
    const unstableResolver = () => `T${++callCount}`;

    builder.fromEntities([Unstable], {
      resolveTableName: unstableResolver,
    });

    // We expect no crash, but probably no indexes/relations added because resolution mismatched
    const ast = builder.getAST();
    // Table "T1" added
    expect(ast.tables.size).toBe(1);

    // Relation attempt tried "T2", failed lookup
    expect(ast.relationships.length).toBe(0);
  });

  it('should ignore indexes on missing columns', () => {
    @Entity()
    class VirtualIndex {
      @Id() id?: number;

      @Field({ virtual: raw('1'), index: true })
      virtualField?: number;
    }

    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([VirtualIndex]);
    const table = ast.getTable('VirtualIndex');
    expect(table?.indexes.length).toBe(0);
  });
});
