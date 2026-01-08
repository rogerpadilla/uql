import { describe, expect, it } from 'vitest';
import type { SchemaDiff } from '../../type/index.js';
import { createMigrationCodeGenerator, MigrationCodeGenerator } from './migrationCodeGenerator.js';

describe('MigrationCodeGenerator', () => {
  describe('generate', () => {
    it('should generate createTable migration', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'users',
        type: 'create',
        columnsToAdd: [
          { name: 'id', type: 'integer', isPrimaryKey: true, isAutoIncrement: true, nullable: false, isUnique: false },
          {
            name: 'email',
            type: 'varchar',
            length: 255,
            nullable: false,
            isUnique: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: 100,
            nullable: true,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("await builder.createTable('users'");
      expect(result.up).toContain("table.id('id')");
      expect(result.up).toContain("table.string('email'");
      expect(result.up).toContain('unique: true');
      expect(result.up).toContain("table.string('name'");
      expect(result.up).toContain('length: 100');
      expect(result.up).toContain('nullable: true');
      expect(result.down).toContain("await builder.dropTable('users')");
      expect(result.description).toContain("Create table 'users'");
    });

    it('should generate dropTable migration', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'old_table',
        type: 'drop',
      };

      const result = generator.generate(diff);

      expect(result.up).toBe("await builder.dropTable('old_table');");
      expect(result.down).toContain('Cannot auto-generate');
    });

    it('should generate addColumn migration', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'users',
        type: 'alter',
        columnsToAdd: [
          {
            name: 'age',
            type: 'integer',
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("await builder.addColumn('users', 'age'");
      expect(result.up).toContain('.notNullable()');
      expect(result.down).toContain("await builder.dropColumn('users', 'age')");
    });

    it('should generate dropColumn migration', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'users',
        type: 'alter',
        columnsToDrop: ['old_field'],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("await builder.dropColumn('users', 'old_field')");
      expect(result.down).toContain('TODO: Re-add dropped columns');
    });

    it('should generate createIndex migration', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'users',
        type: 'alter',
        indexesToAdd: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("await builder.createIndex('users', ['email']");
      expect(result.up).toContain("name: 'idx_users_email'");
      expect(result.up).toContain('unique: true');
      expect(result.down).toContain("await builder.dropIndex('users', 'idx_users_email')");
    });

    it('should generate addForeignKey migration', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'posts',
        type: 'alter',
        foreignKeysToAdd: [
          {
            name: 'fk_posts_author',
            columns: ['authorId'],
            referencedTable: 'users',
            referencedColumns: ['id'],
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
          },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("await builder.addForeignKey('posts', ['authorId']");
      expect(result.up).toContain("table: 'users'");
      expect(result.up).toContain("onDelete: 'CASCADE'");
      expect(result.down).toContain("await builder.dropForeignKey('posts', 'fk_posts_author')");
    });
  });

  describe('generateAll', () => {
    it('should generate multiple diffs in order', () => {
      const generator = new MigrationCodeGenerator();

      const diffs: SchemaDiff[] = [
        {
          tableName: 'users',
          type: 'create',
          columnsToAdd: [
            {
              name: 'id',
              type: 'integer',
              isPrimaryKey: true,
              isAutoIncrement: true,
              nullable: false,
              isUnique: false,
            },
          ],
        },
        {
          tableName: 'posts',
          type: 'create',
          columnsToAdd: [
            {
              name: 'id',
              type: 'integer',
              isPrimaryKey: true,
              isAutoIncrement: true,
              nullable: false,
              isUnique: false,
            },
          ],
        },
      ];

      const result = generator.generateAll(diffs);

      expect(result.up).toContain("createTable('users'");
      expect(result.up).toContain("createTable('posts'");
      // Down should be in reverse order
      expect(result.down.indexOf('posts')).toBeLessThan(result.down.indexOf('users'));
    });
  });

  describe('generateFile', () => {
    it('should generate complete migration file', () => {
      const generator = new MigrationCodeGenerator();

      const diffs: SchemaDiff[] = [
        {
          tableName: 'users',
          type: 'create',
          columnsToAdd: [
            {
              name: 'id',
              type: 'integer',
              isPrimaryKey: true,
              isAutoIncrement: true,
              nullable: false,
              isUnique: false,
            },
            {
              name: 'email',
              type: 'varchar',
              nullable: false,
              isUnique: true,
              isPrimaryKey: false,
              isAutoIncrement: false,
            },
          ],
        },
      ];

      const file = generator.generateFile(diffs, 'create_users');

      expect(file).toContain('Migration: create_users');
      expect(file).toContain("import type { IMigrationBuilder } from '@uql/core'");
      expect(file).toContain('export async function up(builder: IMigrationBuilder)');
      expect(file).toContain('export async function down(builder: IMigrationBuilder)');
      expect(file).toContain("createTable('users'");
    });
  });

  describe('column type mapping', () => {
    it('should map various column types correctly', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'create',
        columnsToAdd: [
          { name: 'a', type: 'bigint', nullable: false, isUnique: false, isPrimaryKey: false, isAutoIncrement: false },
          { name: 'b', type: 'boolean', nullable: false, isUnique: false, isPrimaryKey: false, isAutoIncrement: false },
          {
            name: 'c',
            type: 'timestamp',
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
          { name: 'd', type: 'json', nullable: false, isUnique: false, isPrimaryKey: false, isAutoIncrement: false },
          { name: 'e', type: 'uuid', nullable: false, isUnique: false, isPrimaryKey: false, isAutoIncrement: false },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("table.bigint('a')");
      expect(result.up).toContain("table.boolean('b')");
      expect(result.up).toContain("table.timestamp('c')");
      expect(result.up).toContain("table.json('d')");
      expect(result.up).toContain("table.uuid('e')");
    });

    it('should handle decimal with precision and scale', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'create',
        columnsToAdd: [
          {
            name: 'price',
            type: 'decimal',
            precision: 10,
            scale: 2,
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("table.decimal('price'");
      expect(result.up).toContain('precision: 10');
      expect(result.up).toContain('scale: 2');
    });
  });

  describe('default values', () => {
    it('should handle various default values', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'alter',
        columnsToAdd: [
          {
            name: 'active',
            type: 'boolean',
            defaultValue: true,
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
          {
            name: 'count',
            type: 'integer',
            defaultValue: 0,
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
          {
            name: 'status',
            type: 'varchar',
            defaultValue: 'pending',
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain('.defaultValue(true)');
      expect(result.up).toContain('.defaultValue(0)');
      expect(result.up).toContain(".defaultValue('pending')");
    });

    it('should handle SQL expression default values', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'alter',
        columnsToAdd: [
          {
            name: 'createdAt',
            type: 'timestamp',
            defaultValue: 'CURRENT_TIMESTAMP',
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);

      expect(result.up).toContain("t.raw('CURRENT_TIMESTAMP')");
    });
    it('should handle complex default values (JSON)', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'alter',
        columnsToAdd: [
          {
            name: 'metadata',
            type: 'json',
            defaultValue: { a: 1 },
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);
      expect(result.up).toContain('.defaultValue({"a":1})');
    });

    it('should handle non-unique indexes and primary keys/uniqueness in options', () => {
      const generator = new MigrationCodeGenerator();
      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'create',
        columnsToAdd: [
          { name: 'id', type: 'integer', isPrimaryKey: true, isAutoIncrement: false, nullable: false, isUnique: false },
          { name: 'uid', type: 'string', isUnique: true, nullable: true, isPrimaryKey: false, isAutoIncrement: false },
          {
            name: 'col',
            type: 'string',
            defaultValue: 'def',
            nullable: false,
            isUnique: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
        indexesToAdd: [{ name: 'idx_col', columns: ['col'], unique: false }],
      };

      const result = generator.generate(diff);
      expect(result.up).toContain("table.integer('id', { primaryKey: true })");
      expect(result.up).toContain("table.string('uid', { nullable: true, unique: true })");
      expect(result.up).toContain("table.string('col', { defaultValue: 'def' })");
      expect(result.up).toContain("table.index(['col'], 'idx_col')");
    });

    it('should handle unique() and defaultValue() in column builder (alter)', () => {
      const generator = new MigrationCodeGenerator();
      const diff: SchemaDiff = {
        tableName: 'test',
        type: 'alter',
        columnsToAdd: [
          {
            name: 'new_col',
            type: 'string',
            isUnique: true,
            defaultValue: 'val',
            nullable: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
          },
        ],
      };

      const result = generator.generate(diff);
      expect(result.up).toContain(
        "await builder.addColumn('test', 'new_col', (col) => col.notNullable().unique().defaultValue('val'))",
      );
    });
  });

  describe('alter description', () => {
    it('should generate detailed description for alter', () => {
      const generator = new MigrationCodeGenerator();

      const diff: SchemaDiff = {
        tableName: 'users',
        type: 'alter',
        columnsToAdd: [{ name: 'a', type: 'int' } as any],
        columnsToDrop: ['b'],
        columnsToAlter: [{ from: {} as any, to: { name: 'c' } as any }],
      };

      const result = generator.generate(diff);
      expect(result.description).toContain('Add 1 column(s)');
      expect(result.description).toContain('Drop 1 column(s)');
      expect(result.description).toContain('Alter 1 column(s)');
    });
  });

  describe('createMigrationCodeGenerator factory', () => {
    it('should create generator with custom options', () => {
      const generator = createMigrationCodeGenerator({ indent: '    ', includeComments: false });
      expect(generator).toBeInstanceOf(MigrationCodeGenerator);
    });
  });
});
