import { describe, expect, it, vi } from 'vitest';
import { Entity } from '../entity/decorator/entity.js';
import { Field } from '../entity/decorator/field.js';
import {
  AfterDelete,
  AfterInsert,
  AfterLoad,
  BeforeDelete,
  BeforeInsert,
  BeforeUpdate,
} from '../entity/decorator/hook.js';
import { Id } from '../entity/decorator/id.js';
import type { Querier } from '../type/index.js';
import { type HookContext, runHooks } from './hook.util.js';

// Minimal mock querier for HookContext
const mockQuerier = {} as Querier;
const ctx: HookContext = { querier: mockQuerier };

describe('runHooks', () => {
  it('should call the hook method for each payload', async () => {
    const spy = vi.fn();

    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @Field()
      name?: string;

      @BeforeInsert()
      hook() {
        spy(this.name);
      }
    }

    const payloads = [{ name: 'Alice' } as TestEntity, { name: 'Bob' } as TestEntity];
    await runHooks(TestEntity, 'beforeInsert', payloads, ctx);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('Alice');
    expect(spy).toHaveBeenCalledWith('Bob');
  });

  it('should mutate payload via `this` in Before* hooks', async () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @Field()
      name?: string;

      @Field()
      slug?: string;

      @BeforeInsert()
      generateSlug() {
        this.slug = this.name?.toLowerCase().replace(/\s+/g, '-');
      }
    }

    const payloads = [{ name: 'Hello World' } as TestEntity];
    await runHooks(TestEntity, 'beforeInsert', payloads, ctx);

    expect(payloads[0].slug).toBe('hello-world');
  });

  it('should await async hooks', async () => {
    const order: string[] = [];

    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      async asyncHook() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('async');
      }
    }

    await runHooks(TestEntity, 'beforeInsert', [{} as TestEntity], ctx);
    expect(order).toEqual(['async']);
  });

  it('should pass HookContext with querier to hooks', async () => {
    const receivedCtx = vi.fn();

    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @AfterInsert()
      hook(hookCtx: HookContext) {
        receivedCtx(hookCtx);
      }
    }

    await runHooks(TestEntity, 'afterInsert', [{} as TestEntity], ctx);
    expect(receivedCtx).toHaveBeenCalledWith({ querier: mockQuerier });
  });

  it('should be a no-op when entity has no hooks registered', async () => {
    @Entity()
    class PlainEntity {
      @Id()
      id?: number;

      @Field()
      name?: string;
    }

    const payloads = [{ name: 'test' } as PlainEntity];
    // Should not throw
    await runHooks(PlainEntity, 'beforeInsert', payloads, ctx);
    expect(payloads[0].name).toBe('test');
  });

  it('should be a no-op when event has no hooks', async () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      onInsert() {}
    }

    // beforeUpdate has no hooks registered
    await runHooks(TestEntity, 'beforeUpdate', [{} as TestEntity], ctx);
  });

  it('should execute multiple hooks in registration order', async () => {
    const order: string[] = [];

    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      first() {
        order.push('first');
      }

      @BeforeInsert()
      second() {
        order.push('second');
      }
    }

    await runHooks(TestEntity, 'beforeInsert', [{} as TestEntity], ctx);
    expect(order).toEqual(['first', 'second']);
  });

  it('should support @BeforeUpdate mutating payload', async () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @Field()
      email?: string;

      @BeforeUpdate()
      normalizeEmail() {
        if (this.email) {
          this.email = this.email.toLowerCase();
        }
      }
    }

    const payloads = [{ email: 'USER@EXAMPLE.COM' } as TestEntity];
    await runHooks(TestEntity, 'beforeUpdate', payloads, ctx);
    expect(payloads[0].email).toBe('user@example.com');
  });

  it('should support @AfterLoad with mutation propagation (transforms loaded data)', async () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @Field()
      password?: string;

      @AfterLoad()
      maskPassword() {
        this.password = '***';
      }
    }

    const payloads = [{ password: 'secret123' } as TestEntity];
    await runHooks(TestEntity, 'afterLoad', payloads, ctx);
    // afterLoad IS mutating — its purpose is to transform loaded data
    expect(payloads[0].password).toBe('***');
  });

  it('should support @BeforeDelete hook', async () => {
    const spy = vi.fn();

    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeDelete()
      onDelete() {
        spy('beforeDelete');
      }
    }

    await runHooks(TestEntity, 'beforeDelete', [{} as TestEntity], ctx);
    expect(spy).toHaveBeenCalledWith('beforeDelete');
  });

  it('should support @AfterDelete hook', async () => {
    const spy = vi.fn();

    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @AfterDelete()
      onDelete() {
        spy('afterDelete');
      }
    }

    await runHooks(TestEntity, 'afterDelete', [{} as TestEntity], ctx);
    expect(spy).toHaveBeenCalledWith('afterDelete');
  });
});
