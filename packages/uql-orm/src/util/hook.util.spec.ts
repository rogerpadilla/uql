import { describe, expect, it } from 'vitest';
import { BeforeInsert, Entity, Field, Id } from '../entity/index.js';
import { createMockQuerier } from '../test/index.js';
import { type HookContext, runHooks } from './hook.util.js';

/**
 * `runHooks`' own contract: how a registered method is dispatched. Which events a querier emits, and
 * what each one does to the database, is behaviour rather than dispatch - see `lifecycleHooks.spec.ts`.
 * The event named here is incidental; nothing in `runHooks` branches on it.
 */

const ctx: HookContext = { querier: createMockQuerier() };

@Entity()
class Article {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;

  @Field({ type: String })
  slug?: string;

  @BeforeInsert()
  async slugify(this: Article) {
    await Promise.resolve();
    this.slug = this.title?.toLowerCase().replace(/\s+/g, '-');
  }
}

/** Its hook is the assertion: reaching it at all fails the test that says it must not run. */
@Entity()
class Unhooked {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;

  @BeforeInsert()
  reject() {
    throw new TypeError('a payload-less event has nothing to bind `this` to');
  }
}

describe('runHooks', () => {
  it('should bind `this` to each payload, so an awaited mutation reaches the original object', async () => {
    const payloads = [{ title: 'Hello World' }, { title: 'Second One' }] as Article[];

    await runHooks(Article, 'beforeInsert', payloads, ctx);

    expect(payloads).toEqual([
      { title: 'Hello World', slug: 'hello-world' },
      { title: 'Second One', slug: 'second-one' },
    ]);
  });

  it('should run every method registered for the event, in registration order', async () => {
    const order: string[] = [];

    @Entity()
    class Ordered {
      @Id({ type: Number })
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

    await runHooks(Ordered, 'beforeInsert', [{}, {}] as Ordered[], ctx);

    // Per payload, not per hook: a payload is fully processed before the next one starts.
    expect(order).toEqual(['first', 'second', 'first', 'second']);
  });

  it('should do nothing when the entity registers nothing for the event', async () => {
    const payloads = [{ title: 'untouched' }] as Article[];

    await runHooks(Article, 'beforeUpdate', payloads, ctx);

    expect(payloads).toEqual([{ title: 'untouched' }]);
  });

  it('should do nothing when there are no payloads', async () => {
    await expect(runHooks(Unhooked, 'beforeInsert', [], ctx)).resolves.toBeUndefined();
  });
});
