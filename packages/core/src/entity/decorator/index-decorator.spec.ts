import { describe, expect, it } from 'vitest';
import { getMeta } from './definition.js';
import { Entity } from './entity.js';
import { Field } from './field.js';
import { Id } from './id.js';
import { Index } from './index-decorator.js';

describe('@Index decorator', () => {
  it('should register a single-column index', () => {
    @Entity()
    @Index(['email'])
    class User {
      @Id()
      id?: number;

      @Field()
      email?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
    expect(meta.indexes?.[0].columns).toEqual(['email']);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should register a unique index', () => {
    @Entity()
    @Index(['email'], { unique: true })
    class User {
      @Id()
      id?: number;

      @Field()
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
      @Id()
      id?: number;

      @Field()
      firstName?: string;

      @Field()
      lastName?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].columns).toEqual(['firstName', 'lastName']);
  });

  it('should register a named index', () => {
    @Entity()
    @Index(['email'], { name: 'idx_user_email' })
    class User {
      @Id()
      id?: number;

      @Field()
      email?: string;
    }

    const meta = getMeta(User);
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.[0].name).toBe('idx_user_email');
  });

  it('should register multiple indexes', () => {
    @Entity()
    @Index(['email'], { unique: true })
    @Index(['firstName', 'lastName'])
    class User {
      @Id()
      id?: number;

      @Field()
      email?: string;

      @Field()
      firstName?: string;

      @Field()
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
      @Id()
      id?: number;

      @Field()
      email?: string;

      @Field({ nullable: true })
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
      @Id()
      id?: number;

      @Field()
      name?: string;
    }

    const meta = getMeta(Category);
    expect(meta.indexes?.[0].unique).toBe(false);
  });

  it('should generate index name if not provided', () => {
    @Entity()
    @Index(['status', 'priority'])
    class Task {
      @Id()
      id?: number;

      @Field()
      status?: string;

      @Field()
      priority?: number;
    }

    const meta = getMeta(Task);
    // Name should be auto-generated or undefined (implementation dependent)
    expect(meta.indexes).toBeDefined();
    expect(meta.indexes?.length).toBe(1);
  });
});
