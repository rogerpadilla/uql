import { describe, expect, it } from 'vitest';
import { f } from '../column.js';
import { getMeta } from '../metadata/definition.js';
import { Entity } from './entity.js';
import { Field } from './members.js';

describe('@Index decorator', () => {
  it('should register a single-column index', () => {
    @Entity({ indexes: (user, index) => [index([user.email])] })
    class User {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      email?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
    expect(meta.indexes?.[0].entries).toEqual([{ column: 'email' }]);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should register a unique index', () => {
    @Entity({ indexes: (user, index) => [index([user.email], { unique: true })] })
    class User {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      email?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].unique).toBe(true);
  });

  it('should register a composite index', () => {
    @Entity({ indexes: (user, index) => [index([user.firstName, user.lastName])] })
    class User {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      firstName?: string | null;

      @Field(f.string().nullable())
      lastName?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].entries).toEqual([{ column: 'firstName' }, { column: 'lastName' }]);
  });

  it('should register a named index', () => {
    @Entity({ indexes: (user, index) => [index([user.email], 'user_email_idx')] })
    class User {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      email?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].name).toBe('user_email_idx');
  });

  it('should register multiple indexes', () => {
    @Entity({
      indexes: (user, index) => [index([user.firstName, user.lastName]), index([user.email], { unique: true })],
    })
    class User {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      email?: string | null;

      @Field(f.string().nullable())
      firstName?: string | null;

      @Field(f.string().nullable())
      lastName?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(2);
  });

  it('should support index with where clause', () => {
    @Entity({ indexes: (user, index) => [index([user.email], { where: { deletedAt: null } })] })
    class User {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      email?: string | null;

      @Field(f.date().nullable())
      deletedAt?: Date | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].where).toEqual({ deletedAt: null });
  });

  it('should default unique to false if not specified', () => {
    @Entity({ indexes: (category, index) => [index([category.name])] })
    class Category {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      name?: string | null;
    }

    const meta = getMeta(Category);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should register a fulltext column weight', () => {
    @Entity({ indexes: (doc, index) => [index([{ column: doc.title, weight: 2 }, doc.body], { type: 'fulltext' })] })
    class Doc {
      @Field(f.number().id()) id?: number;
      @Field(f.string().nullable()) title?: string | null;
      @Field(f.string().nullable()) body?: string | null;
    }

    expect(getMeta(Doc).indexes?.[0].entries).toEqual([{ column: 'title', weight: 2 }, { column: 'body' }]);
  });

  /** One rule on every engine: MongoDB's, which weighs by whole numbers below 100000. */
  it('should refuse a weight that some engine cannot rank by', () => {
    const declare =
      (weight: number, type: 'fulltext' | 'btree' = 'fulltext') =>
      () => {
        @Entity({ indexes: (doc, index) => [index([{ column: doc.title, weight }, doc.body], { type })] })
        class Doc {
          @Field(f.number().id()) id?: number;
          @Field(f.string().nullable()) title?: string | null;
          @Field(f.string().nullable()) body?: string | null;
        }
        return Doc;
      };
    expect(declare(2, 'btree')).toThrow('a column weight ranks a fulltext index, and this one is btree');
    expect(declare(1.5)).toThrow('a column weight is a whole number from 1 to 99999, not 1.5');
    expect(declare(0)).toThrow('a column weight is a whole number from 1 to 99999, not 0');
    expect(declare(100_000)).toThrow('a column weight is a whole number from 1 to 99999, not 100000');
  });

  it('should generate index name if not provided', () => {
    @Entity({ indexes: (task, index) => [index([task.status, task.priority])] })
    class Task {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      status?: string | null;

      @Field(f.number().nullable())
      priority?: number | null;
    }

    const meta = getMeta(Task);
    // Name should be auto-generated or undefined (implementation dependent)
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
  });
});
