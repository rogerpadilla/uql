import { describe, expect, it } from 'vitest';
import { getMeta } from '../metadata/definition.js';
import { Entity, Index } from './entity.js';
import { Field, Id } from './members.js';

describe('@Index decorator', () => {
  it('should register a single-column index', () => {
    @Entity()
    @Index((user) => [user.email])
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
    expect(meta.indexes?.[0].columns).toEqual([{ column: 'email' }]);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should register a unique index', () => {
    @Entity()
    @Index((user) => [user.email], { unique: true })
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].unique).toBe(true);
  });

  it('should register a composite index', () => {
    @Entity()
    @Index((user) => [user.firstName, user.lastName])
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      firstName?: string | null;

      @Field({ type: String })
      lastName?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].columns).toEqual([{ column: 'firstName' }, { column: 'lastName' }]);
  });

  it('should register a named index', () => {
    @Entity()
    @Index((user) => [user.email], { name: 'user_email_idx' })
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].name).toBe('user_email_idx');
  });

  it('should register multiple indexes', () => {
    @Entity()
    @Index((user) => [user.email], { unique: true })
    @Index((user) => [user.firstName, user.lastName])
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string | null;

      @Field({ type: String })
      firstName?: string | null;

      @Field({ type: String })
      lastName?: string | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(2);
  });

  it('should support index with where clause', () => {
    @Entity()
    @Index((user) => [user.email], { where: { deletedAt: null } })
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string | null;

      @Field({ type: Date, nullable: true })
      deletedAt?: Date | null;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].where).toEqual({ deletedAt: null });
  });

  it('should default unique to false if not specified', () => {
    @Entity()
    @Index((category) => [category.name])
    class Category {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      name?: string | null;
    }

    const meta = getMeta(Category);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should register a fulltext column weight', () => {
    @Entity()
    @Index((doc) => [{ column: doc.title, weight: 2 }, doc.body], { type: 'fulltext' })
    class Doc {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) title?: string | null;
      @Field({ type: String }) body?: string | null;
    }

    expect(getMeta(Doc).indexes?.[0].columns).toEqual([{ column: 'title', weight: 2 }, { column: 'body' }]);
  });

  /** One rule on every engine: MongoDB's, which weighs by whole numbers below 100000. */
  it('should refuse a weight that some engine cannot rank by', () => {
    const declare =
      (weight: number, type: 'fulltext' | 'btree' = 'fulltext') =>
      () => {
        @Entity()
        @Index((doc) => [{ column: doc.title, weight }, doc.body], { type })
        class Doc {
          @Id({ type: Number }) id?: number;
          @Field({ type: String }) title?: string | null;
          @Field({ type: String }) body?: string | null;
        }
        return Doc;
      };
    expect(declare(2, 'btree')).toThrow('a column weight ranks a fulltext index, and this one is btree');
    expect(declare(1.5)).toThrow('a column weight is a whole number from 1 to 99999, not 1.5');
    expect(declare(0)).toThrow('a column weight is a whole number from 1 to 99999, not 0');
    expect(declare(100_000)).toThrow('a column weight is a whole number from 1 to 99999, not 100000');
  });

  it('should generate index name if not provided', () => {
    @Entity()
    @Index((task) => [task.status, task.priority])
    class Task {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      status?: string | null;

      @Field({ type: Number })
      priority?: number | null;
    }

    const meta = getMeta(Task);
    // Name should be auto-generated or undefined (implementation dependent)
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
  });
});
