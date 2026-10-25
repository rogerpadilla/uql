import { describe, expect, it } from 'vitest';
import { BeforeInsert, defineEntity, Entity, f, Field } from '../entity/index.js';
import { createMockQuerier } from '../test/index.js';
import type { HookContext } from '../type/index.js';
import { runHooks } from './hook.util.js';

/**
 * `runHooks`' own contract: how a registered method is dispatched. Which events a querier emits, and
 * what each one does to the database, is behaviour rather than dispatch - see `lifecycleHooks.spec.ts`.
 * The event named here is incidental; nothing in `runHooks` branches on it.
 */

const querier = createMockQuerier();
const ctx: HookContext = { querier, onCommit: querier.onCommit };

@Entity()
class Article {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable())
  title?: string | null;

  @Field(f.string().nullable())
  slug?: string | null;

  @BeforeInsert()
  async slugify(this: Article) {
    await Promise.resolve();
    this.slug = this.title?.toLowerCase().replace(/\s+/g, '-');
  }
}

/** Its hook is the assertion: reaching it at all fails the test that says it must not run. */
@Entity()
class Unhooked {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable())
  title?: string | null;

  @BeforeInsert()
  reject() {
    throw new TypeError('a payload-less event has nothing to bind `this` to');
  }
}

describe('runHooks', () => {
  it('should bind `this` to each payload, so an awaited mutation reaches the original object', async () => {
    const payloads = [
      Object.assign(new Article(), { title: 'Hello World' }),
      Object.assign(new Article(), { title: 'Second One' }),
    ];

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
      @Field(f.number().id())
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

    await runHooks(Ordered, 'beforeInsert', [new Ordered(), new Ordered()], ctx);

    // Per payload, not per hook: a payload is fully processed before the next one starts.
    expect(order).toEqual(['first', 'second', 'first', 'second']);
  });

  it('should do nothing when the entity registers nothing for the event', async () => {
    const payloads = [Object.assign(new Article(), { title: 'untouched' })];

    await runHooks(Article, 'beforeUpdate', payloads, ctx);

    expect(payloads).toEqual([{ title: 'untouched' }]);
  });

  it("should await a schema's hook, each run on the row with the context", async () => {
    const Note = defineEntity({
      name: 'Note',
      fields: { id: f.number().id(), body: f.string().nullable(), seen: f.boolean().nullable() },
    }).hooks({
      beforeInsert: [
        async (note, { querier: given }) => {
          await Promise.resolve();
          note.seen = given === querier;
        },
        (note) => void (note.body = note.body?.trim() ?? null),
      ],
    });
    const note: InstanceType<typeof Note> = { id: 1, body: ' hi ' };

    await runHooks(Note, 'beforeInsert', [note], ctx);

    expect(note).toEqual({ id: 1, body: 'hi', seen: true });
  });

  it("should run a schema base's hooks on the entities extending it", async () => {
    const Stamped = defineEntity({
      name: 'Stamped',
      abstract: true,
      fields: { by: f.string().nullable() },
    }).hooks({ beforeInsert: [(row) => void (row.by ??= 'base')] });
    const Note = defineEntity({ name: 'Note', extends: Stamped, fields: { id: f.number().id() } });
    const note: InstanceType<typeof Note> = { id: 1 };

    await runHooks(Note, 'beforeInsert', [note], ctx);

    expect(note.by).toBe('base');
  });

  it('should do nothing when there are no payloads', async () => {
    await expect(runHooks(Unhooked, 'beforeInsert', [], ctx)).resolves.toBeUndefined();
  });

  it('should refuse a hook on a member that is no method where the entity is declared, naming both', () => {
    expect(() => {
      @Entity()
      class Misnamed {
        @Field(f.number().id())
        id?: number;
        // @ts-expect-error covers the runtime guard for untyped callers
        @BeforeInsert()
        stamp?: string;
      }
      return Misnamed;
    }).toThrow("'Misnamed' runs 'stamp' on beforeInsert, but has no such method");
  });

  it("should run an entity's override of the hook method its base declares", async () => {
    @Entity()
    class Stamped {
      @Field(f.number().id())
      id?: number;
      @Field(f.string().nullable())
      by?: string | null;
      @BeforeInsert()
      stamp(): void {
        this.by = 'base';
      }
    }
    @Entity()
    class Restamped extends Stamped {
      override stamp(): void {
        this.by = 'child';
      }
    }
    const row = new Restamped();

    await runHooks(Restamped, 'beforeInsert', [row], ctx);

    expect(row.by).toBe('child');
  });

  it("should run an entity's override of a hook method named by the empty string", async () => {
    @Entity()
    class Blank {
      @Field(f.number().id())
      id?: number;
      @Field(f.string().nullable())
      by?: string | null;
      @BeforeInsert()
      ['']() {
        this.by = 'base';
      }
    }
    @Entity()
    class Reblanked extends Blank {
      override ['']() {
        this.by = 'child';
      }
    }
    const row = new Reblanked();

    await runHooks(Reblanked, 'beforeInsert', [row], ctx);

    expect(row.by).toBe('child');
  });
});
