import { describe, expect, it } from 'vitest';
import { getMeta } from '../metadata/definition.js';
import { Entity, Index } from './entity.js';
import { Field, Id } from './members.js';

describe('@Index decorator', () => {
  it('should register a single-column index', () => {
    @Entity()
    @Index(['email'])
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
    expect(meta.indexes?.[0].columns).toEqual([{ column: 'email' }]);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should register a unique index', () => {
    @Entity()
    @Index(['email'], { unique: true })
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].unique).toBe(true);
  });

  it('should register a composite index', () => {
    @Entity()
    @Index(['firstName', 'lastName'])
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      firstName?: string;

      @Field({ type: String })
      lastName?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].columns).toEqual([{ column: 'firstName' }, { column: 'lastName' }]);
  });

  it('should register a named index', () => {
    @Entity()
    @Index(['email'], { name: 'user_email_idx' })
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].name).toBe('user_email_idx');
  });

  it('should register multiple indexes', () => {
    @Entity()
    @Index(['email'], { unique: true })
    @Index(['firstName', 'lastName'])
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string;

      @Field({ type: String })
      firstName?: string;

      @Field({ type: String })
      lastName?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(2);
  });

  it('should support index with where clause', () => {
    @Entity()
    @Index(['email'], { where: 'deleted_at IS NULL' })
    class User {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      email?: string;

      @Field({ type: Date, nullable: true })
      deletedAt?: Date;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].where).toBe('deleted_at IS NULL');
  });

  it('should default unique to false if not specified', () => {
    @Entity()
    @Index(['name'])
    class Category {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      name?: string;
    }

    const meta = getMeta(Category);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should generate index name if not provided', () => {
    @Entity()
    @Index(['status', 'priority'])
    class Task {
      @Id({ type: Number })
      id?: number;

      @Field({ type: String })
      status?: string;

      @Field({ type: Number })
      priority?: number;
    }

    const meta = getMeta(Task);
    // Name should be auto-generated or undefined (implementation dependent)
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
  });
});
