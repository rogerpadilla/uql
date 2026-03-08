import { describe, expect, it } from 'vitest';
import { getMeta } from './definition.js';
import { Entity } from './entity.js';
import { Field } from './field.js';
import { AfterInsert, AfterLoad, AfterUpdate, BeforeDelete, BeforeInsert, BeforeUpdate } from './hook.js';
import { Id } from './id.js';

describe('hook decorators', () => {
  it('should register a @BeforeInsert hook', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      onBeforeInsert() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'onBeforeInsert' }]);
  });

  it('should register a @AfterInsert hook', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @AfterInsert()
      onAfterInsert() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.afterInsert).toEqual([{ methodName: 'onAfterInsert' }]);
  });

  it('should register a @BeforeUpdate hook', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeUpdate()
      onBeforeUpdate() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeUpdate).toEqual([{ methodName: 'onBeforeUpdate' }]);
  });

  it('should register a @AfterUpdate hook', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @AfterUpdate()
      onAfterUpdate() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.afterUpdate).toEqual([{ methodName: 'onAfterUpdate' }]);
  });

  it('should register @AfterLoad hook', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @AfterLoad()
      onLoad() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.afterLoad).toEqual([{ methodName: 'onLoad' }]);
  });

  it('should register @BeforeDelete hook', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeDelete()
      onBeforeDelete() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeDelete).toEqual([{ methodName: 'onBeforeDelete' }]);
  });

  it('should register multiple hooks for the same event', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      firstHook() {}

      @BeforeInsert()
      secondHook() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'firstHook' }, { methodName: 'secondHook' }]);
  });

  it('should register hooks for multiple different events', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      onInsert() {}

      @AfterUpdate()
      onUpdate() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'onInsert' }]);
    expect(meta.hooks?.afterUpdate).toEqual([{ methodName: 'onUpdate' }]);
  });

  it('should support stacking multiple decorators on one method', () => {
    @Entity()
    class TestEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      @BeforeUpdate()
      normalize() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'normalize' }]);
    expect(meta.hooks?.beforeUpdate).toEqual([{ methodName: 'normalize' }]);
  });

  it('should inherit hooks from parent entity', () => {
    class BaseEntity {
      @Id()
      id?: number;

      @BeforeInsert()
      baseHook() {}
    }

    @Entity()
    class ChildEntity extends BaseEntity {
      @Field()
      name?: string;

      @BeforeInsert()
      childHook() {}
    }

    const meta = getMeta(ChildEntity);
    // Parent hooks come first
    expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'baseHook' }, { methodName: 'childHook' }]);
  });

  it('should not have hooks when none are defined', () => {
    @Entity()
    class PlainEntity {
      @Id()
      id?: number;

      @Field()
      name?: string;
    }

    const meta = getMeta(PlainEntity);
    expect(meta.hooks).toBeUndefined();
  });
});
