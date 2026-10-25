import { describe, expect, it } from 'vitest';
import { f } from '../column.js';
import { getMeta } from '../metadata/definition.js';
import { Entity } from './entity.js';
import { AfterInsert, AfterLoad, AfterUpdate, BeforeDelete, BeforeInsert, BeforeUpdate, Field } from './members.js';

describe('hook decorators', () => {
  it('should register a @BeforeInsert hook', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      onBeforeInsert() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'onBeforeInsert' }]);
  });

  it('should register a @AfterInsert hook', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @AfterInsert()
      onAfterInsert() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.afterInsert).toMatchObject([{ methodName: 'onAfterInsert' }]);
  });

  it('should register a @BeforeUpdate hook', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeUpdate()
      onBeforeUpdate() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeUpdate).toMatchObject([{ methodName: 'onBeforeUpdate' }]);
  });

  it('should register a @AfterUpdate hook', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @AfterUpdate()
      onAfterUpdate() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.afterUpdate).toMatchObject([{ methodName: 'onAfterUpdate' }]);
  });

  it('should register @AfterLoad hook', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @AfterLoad()
      onLoad() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.afterLoad).toMatchObject([{ methodName: 'onLoad' }]);
  });

  it('should register @BeforeDelete hook', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeDelete()
      onBeforeDelete() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeDelete).toMatchObject([{ methodName: 'onBeforeDelete' }]);
  });

  it('should register multiple hooks for the same event', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      firstHook() {}

      @BeforeInsert()
      secondHook() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'firstHook' }, { methodName: 'secondHook' }]);
  });

  it('should register hooks for multiple different events', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      onInsert() {}

      @AfterUpdate()
      onUpdate() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'onInsert' }]);
    expect(meta.hooks?.afterUpdate).toMatchObject([{ methodName: 'onUpdate' }]);
  });

  it('should support stacking multiple decorators on one method', () => {
    @Entity()
    class TestEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      @BeforeUpdate()
      normalize() {}
    }

    const meta = getMeta(TestEntity);
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'normalize' }]);
    expect(meta.hooks?.beforeUpdate).toMatchObject([{ methodName: 'normalize' }]);
  });

  it('should inherit hooks from parent entity', () => {
    class BaseEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      baseHook() {}
    }

    @Entity()
    class ChildEntity extends BaseEntity {
      @Field(f.string().nullable())
      name?: string | null;

      @BeforeInsert()
      childHook() {}
    }

    const meta = getMeta(ChildEntity);
    // Parent hooks come first
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'baseHook' }, { methodName: 'childHook' }]);
  });

  it('should inherit parent hooks when the child declares none of its own', () => {
    class BaseEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      baseHook() {}
    }

    @Entity()
    class ChildEntity extends BaseEntity {
      @Field(f.string().nullable())
      name?: string | null;
    }

    const meta = getMeta(ChildEntity);
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'baseHook' }]);
  });

  it('should merge parent and child hooks registered on different events', () => {
    class BaseEntity {
      @Field(f.number().id())
      id?: number;

      @BeforeInsert()
      baseHook() {}
    }

    @Entity()
    class ChildEntity extends BaseEntity {
      @Field(f.string().nullable())
      name?: string | null;

      @AfterUpdate()
      childHook() {}
    }

    const meta = getMeta(ChildEntity);
    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'baseHook' }]);
    expect(meta.hooks?.afterUpdate).toMatchObject([{ methodName: 'childHook' }]);
  });

  it('should not have hooks when none are defined', () => {
    @Entity()
    class PlainEntity {
      @Field(f.number().id())
      id?: number;

      @Field(f.string().nullable())
      name?: string | null;
    }

    const meta = getMeta(PlainEntity);
    expect(meta.hooks).toBeUndefined();
  });
});
