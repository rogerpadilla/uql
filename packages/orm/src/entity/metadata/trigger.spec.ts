import { describe, expect, it } from 'vitest';
import type { TriggerOptions } from '../../type/index.js';
import { raw } from '../../util/raw.js';
import { Entity, Field, Id, removeEntity } from '../index.js';
import { defineTrigger, getMeta } from './definition.js';

const body = () => raw`PERFORM 1;`;

/** A throwaway entity, since a trigger is registered against a class and read back off its metadata. */
function entityWith(...triggers: TriggerOptions<Post>[]) {
  @Entity({ name: `Post_${triggers.length}_${Math.random().toString(36).slice(2, 8)}` })
  class Post {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) body?: string | null;
  }
  for (const trigger of triggers) {
    defineTrigger(Post, trigger);
  }
  return Post;
}

declare class Post {
  id?: number;
  body?: string | null;
}

describe('defineTrigger', () => {
  it('should keep the triggers in the order they were written', () => {
    const entity = entityWith({ on: 'afterInsert', run: body }, { on: 'beforeUpdate', run: body });
    expect(getMeta(entity).triggers?.map((it) => it.on)).toEqual(['afterInsert', 'beforeUpdate']);
    removeEntity(entity);
  });

  it('should resolve the watched columns to their keys', () => {
    const entity = entityWith({ on: 'beforeUpdate', of: (post) => [post.body], run: body });
    expect(getMeta(entity).triggers?.[0]?.of).toEqual(['body']);
    removeEntity(entity);
  });

  // A compile error in TypeScript; this is the backstop for plain JavaScript and for options that arrive
  // untyped, which `JSON.parse` stands in for.
  it('should refuse a body naming no engine uql renders for', () => {
    expect(() => entityWith({ on: 'afterInsert', run: JSON.parse('{}') })).toThrow(/at least one engine/);
  });

  it('should refuse two triggers sharing a name, which one drop could not tell apart', () => {
    expect(() =>
      entityWith({ on: 'afterInsert', name: 'x', run: body }, { on: 'afterUpdate', name: 'x', run: body }),
    ).toThrow(/'x'/);
  });
});
