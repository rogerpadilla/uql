import { beforeEach, describe, expect, it } from 'vitest';
import { createTableNode, SchemaAST } from './schemaAST.js';
import type { ColumnNode, RelationshipNode, TableNode } from './types.js';

describe('SchemaAST', () => {
  let ast: SchemaAST;

  beforeEach(() => {
    ast = new SchemaAST();
  });

  it('should key a table by its schema-qualified name', () => {
    const users = createTable('users');
    const accounts = createTableNode('accounts', 'crm');
    ast.addTable(users);
    ast.addTable(accounts);

    expect(ast.getTable('users')).toBe(users);
    expect(ast.getTable('crm.accounts')).toBe(accounts);
    expect(ast.getTable('accounts')).toBeUndefined();
    expect(ast.getTables()).toEqual([users, accounts]);
  });

  it('should link a relationship from both tables and both column sets', () => {
    const users = createTable('users');
    const posts = createTable('posts');
    const rel = createRelationship('posts_user_fk', posts, users);
    ast.addRelationship(rel);

    expect(ast.relationships).toEqual([rel]);
    expect(posts.outgoingRelations).toEqual([rel]);
    expect(users.incomingRelations).toEqual([rel]);
  });

  it('should order tables for CREATE after what they reference, and for DROP before it', () => {
    const users = createTable('users');
    const posts = createTable('posts');
    const comments = createTable('comments');
    ast.addTable(comments);
    ast.addTable(posts);
    ast.addTable(users);
    ast.addRelationship(createRelationship('posts_user_fk', posts, users));
    ast.addRelationship(createRelationship('comments_post_fk', comments, posts));

    expect(ast.getCreateOrder().map((table) => table.name)).toEqual(['users', 'posts', 'comments']);
    expect(ast.getDropOrder().map((table) => table.name)).toEqual(['comments', 'posts', 'users']);
  });
});

function createTable(name: string, columnCount = 2): TableNode {
  const table = createTableNode(name);
  for (let i = 0; i < columnCount; i++) {
    const col: ColumnNode = {
      name: `col${i}`,
      type: { category: 'string' },
      nullable: true,
      isPrimaryKey: i === 0,
      isAutoIncrement: i === 0,
      isUnique: false,
      table,
    };
    table.columns.set(col.name, col);
  }
  return table;
}

function createRelationship(name: string, from: TableNode, to: TableNode): RelationshipNode {
  const [fromCol] = [...from.columns.values()].slice(1);
  const [toCol] = to.columns.values();
  return {
    name,
    type: 'ManyToOne',
    from: { table: from, columns: [fromCol] },
    to: { table: to, columns: [toCol] },
  };
}
