import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AfterDelete,
  AfterInsert,
  AfterLoad,
  AfterUpdate,
  BeforeDelete,
  BeforeInsert,
  BeforeUpdate,
  Entity,
  Field,
  Id,
  ManyToOne,
  OneToMany,
} from '../entity/index.js';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import type { Querier, QuerierListener } from '../type/index.js';
import { getKeys, type HookContext } from '../util/index.js';

/**
 * Every hook, observed through the public querier API rather than through `emitHook`: the emission
 * being correct is not the feature, the hook running is, and asserting the former is what let
 * `beforeDelete`/`afterDelete` ship never running at all.
 */

/** What ran, in order. Reset before each test. */
let log: string[] = [];

@Entity()
class Book {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;

  @Field({ type: String })
  slug?: string;

  @BeforeInsert()
  async slugify(this: Book) {
    // Awaited by the querier: the assignment lands a turn of the event loop later, so a hook that
    // was called and not waited for would persist a null slug.
    await Promise.resolve();
    log.push(`beforeInsert:${this.title}`);
    this.slug = this.title?.toLowerCase().replace(/\s+/g, '-');
  }

  @AfterInsert()
  recordInsert(this: Book) {
    log.push(`afterInsert:${this.title}`);
  }

  @BeforeUpdate()
  recordBeforeUpdate(this: Book) {
    log.push(`beforeUpdate:${this.title}`);
  }

  @AfterUpdate()
  recordAfterUpdate(this: Book) {
    log.push(`afterUpdate:${this.title}`);
  }

  @BeforeDelete()
  recordBeforeDelete(this: Book) {
    log.push(`beforeDelete:${this.title}`);
  }

  @AfterDelete()
  recordAfterDelete(this: Book) {
    log.push(`afterDelete:${this.title}`);
  }

  @AfterLoad()
  recordLoad(this: Book) {
    log.push(`afterLoad:${this.title}`);
  }
}

/** No hooks: what a delete costs when nothing is watching. */
@Entity()
class Plain {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;
}

/** Masking on load, which is what `@AfterLoad` propagating its mutations is for. */
@Entity()
class Secret {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  code?: string;

  @AfterLoad()
  mask(this: Secret) {
    this.code = '***';
  }
}

@Entity()
class Archived {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;

  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number;

  @BeforeDelete()
  recordBeforeDelete(this: Archived) {
    log.push(`beforeDelete:${this.title}`);
  }
}

class Timestamped {
  @Id({ type: Number })
  id?: number;

  @BeforeInsert()
  stamp() {
    log.push('parent');
  }
}

@Entity()
class Note extends Timestamped {
  @Field({ type: String })
  title?: string;

  @BeforeInsert()
  first() {
    log.push('first');
  }

  @BeforeInsert()
  second() {
    log.push('second');
  }
}

@Entity()
class Guarded {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;

  @BeforeInsert()
  reject() {
    throw new TypeError('rejected by hook');
  }
}

@Entity()
class Late {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string;

  @AfterInsert()
  reject() {
    throw new TypeError('rejected after the write');
  }
}

/** The documented use for `HookContext`: query through the hook's own querier. */
@Entity()
class Unique {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  email?: string;

  @BeforeInsert()
  async countTaken(this: Unique, ctx: HookContext) {
    log.push(`inTransaction:${ctx.querier.hasOpenTransaction}`);
    log.push(`taken:${await ctx.querier.count(Unique, { $where: { email: this.email } })}`);
  }
}

@Entity()
class Shelf {
  @Id({ type: Number })
  id?: number;

  @OneToMany({ entity: () => ShelvedBook, mappedBy: (book) => book.shelf, cascade: 'delete' })
  books?: ShelvedBook[];
}

@Entity()
class ShelvedBook {
  @Id({ type: Number })
  id?: number;

  @Field({ type: Number })
  shelfId?: number;

  @Field({ type: String })
  title?: string;

  @ManyToOne({ entity: () => Shelf, references: [{ local: 'shelfId', foreign: 'id' }] })
  shelf?: Shelf;

  @BeforeDelete()
  recordBeforeDelete(this: ShelvedBook) {
    log.push(`cascaded:${this.title}`);
  }
}

const TABLES = {
  Book: '`id` INTEGER PRIMARY KEY, `title` TEXT, `slug` TEXT',
  Plain: '`id` INTEGER PRIMARY KEY, `title` TEXT',
  Secret: '`id` INTEGER PRIMARY KEY, `code` TEXT',
  Archived: '`id` INTEGER PRIMARY KEY, `title` TEXT, `deletedAt` BIGINT',
  Note: '`id` INTEGER PRIMARY KEY, `title` TEXT',
  Guarded: '`id` INTEGER PRIMARY KEY, `title` TEXT',
  Late: '`id` INTEGER PRIMARY KEY, `title` TEXT',
  Unique: '`id` INTEGER PRIMARY KEY, `email` TEXT',
  Shelf: '`id` INTEGER PRIMARY KEY',
  ShelvedBook: '`id` INTEGER PRIMARY KEY, `shelfId` INTEGER, `title` TEXT',
};

const pool = new Sqlite3QuerierPool(':memory:');
type PooledQuerier = Awaited<ReturnType<typeof pool.getQuerier>>;

/** Drops first: the pooled `:memory:` connection is reused, so rows outlive the test that wrote them. */
const createTable = async (querier: PooledQuerier, table: keyof typeof TABLES) => {
  await querier.run(`DROP TABLE IF EXISTS \`${table}\``);
  await querier.run(`CREATE TABLE \`${table}\` (${TABLES[table]})`);
};

describe('lifecycle hooks', () => {
  let querier: PooledQuerier;

  beforeEach(async () => {
    log = [];
    querier = await pool.getQuerier();
    for (const table of getKeys(TABLES)) {
      await createTable(querier, table);
    }
  });

  afterEach(() => querier.release());

  afterAll(() => pool.end());

  describe('every event fires through the public API', () => {
    /** One row per hook event, each acting through the API a caller would actually reach for. */
    const cases = [
      {
        event: 'insert',
        act: (q: Querier) => q.insertOne(Book, { title: 'New Title' }),
        expected: ['beforeInsert:New Title', 'afterInsert:New Title'],
      },
      {
        event: 'update',
        act: (q: Querier) => q.updateOneById(Book, 1, { title: 'Renamed' }),
        expected: ['beforeUpdate:Renamed', 'afterUpdate:Renamed'],
      },
      {
        event: 'delete',
        act: (q: Querier) => q.deleteOneById(Book, 1),
        expected: ['beforeDelete:Seeded', 'afterDelete:Seeded'],
      },
      {
        event: 'load',
        act: (q: Querier) => q.findMany(Book, { $select: { id: true, title: true } }),
        expected: ['afterLoad:Seeded'],
      },
    ] as const;

    beforeEach(async () => {
      await querier.insertOne(Book, { title: 'Seeded' });
      log = [];
    });

    for (const { event, act, expected } of cases) {
      it(`should run the ${event} hooks, in order`, async () => {
        await act(querier);

        expect(log).toEqual(expected);
      });
    }
  });

  it('should persist what a @BeforeInsert hook assigned, having awaited it', async () => {
    await querier.insertOne(Book, { title: 'Hello World' });

    expect(await querier.findMany(Book, { $select: { slug: true } })).toEqual([{ slug: 'hello-world' }]);
  });

  it('should return what an @AfterLoad hook assigned', async () => {
    await querier.insertOne(Secret, { code: 'plaintext' });

    expect(await querier.findMany(Secret, { $select: { id: true, code: true } })).toEqual([{ id: 1, code: '***' }]);
  });

  it('should run @AfterLoad once per loaded row', async () => {
    await querier.insertMany(Book, [{ title: 'One' }, { title: 'Two' }]);
    log = [];

    await querier.findMany(Book, { $select: { title: true } });

    expect(log).toEqual(['afterLoad:One', 'afterLoad:Two']);
  });

  it('should run inherited hooks first, then each own hook in declaration order', async () => {
    await querier.insertOne(Note, { title: 'n' });

    expect(log).toEqual(['parent', 'first', 'second']);
  });

  describe('delete hooks', () => {
    it('should receive the row being deleted, and still name it after it is gone', async () => {
      await querier.insertMany(Book, [{ title: 'Keep' }, { title: 'Drop' }]);
      log = [];

      const changes = await querier.deleteMany(Book, { $where: { title: 'Drop' } });

      expect(changes).toBe(1);
      // Both hooks read `Drop` off the same pre-delete snapshot: `afterDelete` runs when the row no
      // longer exists to be read.
      expect(log).toEqual(['beforeDelete:Drop', 'afterDelete:Drop']);
      expect(await querier.findMany(Book, { $select: { title: true } })).toEqual([{ title: 'Keep' }]);
    });

    it('should receive one payload per matched row', async () => {
      await querier.insertMany(Book, [{ title: 'One' }, { title: 'Two' }]);
      log = [];

      await querier.deleteMany(Book, {});

      expect(log).toEqual(['beforeDelete:One', 'beforeDelete:Two', 'afterDelete:One', 'afterDelete:Two']);
    });

    it('should not read the rows back when nothing handles the event', async () => {
      await querier.insertOne(Plain, { title: 'p' });
      const all = vi.spyOn(querier, 'all');

      await querier.deleteMany(Plain, { $where: { id: 1 } });

      // The snapshot exists for the hooks; without one it would be a round trip bought for nobody.
      expect(all).toHaveBeenCalledTimes(0);
    });

    it('should fire for a soft delete, which is still a delete to its caller', async () => {
      await querier.insertOne(Archived, { title: 'a' });
      log = [];

      await querier.deleteOneById(Archived, 1);

      expect(log).toEqual(['beforeDelete:a']);
      expect(await querier.findMany(Archived, { $select: { id: true } })).toEqual([]);
    });

    it('should see an already-soft-deleted row when the delete is hard', async () => {
      await querier.insertOne(Archived, { title: 'a' });
      await querier.deleteOneById(Archived, 1);
      log = [];

      // The row is invisible to a normal read by now, so the snapshot has to drop the soft-delete
      // filter or the hook would never hear about the row that is actually being removed.
      await querier.deleteOneById(Archived, 1, { hardDelete: true });

      expect(log).toEqual(['beforeDelete:a']);
    });

    it('should fire on children removed by a cascade', async () => {
      await querier.insertOne(Shelf, { id: 1 });
      await querier.insertMany(ShelvedBook, [
        { shelfId: 1, title: 'child a' },
        { shelfId: 1, title: 'child b' },
      ]);
      log = [];

      await querier.deleteOneById(Shelf, 1);

      expect(log).toEqual(['cascaded:child a', 'cascaded:child b']);
    });
  });

  describe('a hook that throws', () => {
    it('should abort the operation it precedes', async () => {
      await expect(querier.insertOne(Guarded, { title: 'g' })).rejects.toThrow('rejected by hook');

      expect(await querier.findMany(Guarded, { $select: { id: true } })).toEqual([]);
    });

    it('should roll back the transaction it runs in', async () => {
      await expect(
        querier.transaction(async () => {
          await querier.insertOne(Plain, { title: 'committed?' });
          await querier.insertOne(Guarded, { title: 'g' });
        }),
      ).rejects.toThrow('rejected by hook');

      // The write that already succeeded goes with it: the hook threw inside the transaction.
      expect(await querier.findMany(Plain, { $select: { id: true } })).toEqual([]);
    });

    it('should surface from an after* hook without unwriting the row', async () => {
      await expect(querier.insertOne(Late, { title: 'l' })).rejects.toThrow('rejected after the write');

      // Nothing rolls back an autocommitted statement, so the row stays: an `after*` hook is for
      // side effects, and one that throws reports its own failure, not the write's.
      expect(await querier.findMany(Late, { $select: { title: true } })).toEqual([{ title: 'l' }]);
    });
  });

  describe('HookContext', () => {
    it('should expose a querier that reads the transaction the hook runs in', async () => {
      await querier.transaction(async () => {
        await querier.insertOne(Unique, { email: 'a@b.c' });
        log = [];
        await querier.insertOne(Unique, { email: 'a@b.c' });
      });

      // The count sees the uncommitted sibling row, which is the whole point of handing hooks the
      // active querier rather than a fresh one.
      expect(log).toEqual(['inTransaction:true', 'taken:1']);
    });

    it('should expose a querier outside a transaction too', async () => {
      await querier.insertOne(Unique, { email: 'a@b.c' });

      expect(log).toEqual(['inTransaction:false', 'taken:0']);
    });
  });

  /**
   * Upsert stays hook-free on purpose: which branch a row takes is decided by the database as the
   * statement runs, so there is no honest moment to fire `beforeInsert` rather than `beforeUpdate`.
   */
  it('should not run insert or update hooks for an upsert', async () => {
    await querier.upsertOne(Book, { id: true }, { id: 1, title: 'Upserted' });

    expect(log).toEqual([]);
    expect(await querier.findMany(Book, { $select: { title: true, slug: true } })).toEqual([
      { title: 'Upserted', slug: null },
    ]);
  });

  it('should not run @AfterLoad on streamed rows', async () => {
    await querier.insertOne(Book, { title: 'Streamed' });
    log = [];

    for await (const _ of querier.findManyStream(Book, { $select: { id: true } })) {
      // drained: a stream has no point at which every row has been seen
    }

    expect(log).toEqual([]);
  });
});

describe('global listeners', () => {
  const isBook = (payload: object): payload is Book => 'title' in payload;
  const listener: QuerierListener = {
    beforeDelete: async ({ entity, payloads }) => {
      await Promise.resolve();
      log.push(`listener:${entity.name}:${payloads.filter(isBook).map(({ title }) => title)}`);
    },
    afterInsert: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push('listener:awaited');
    },
  };
  const listenerPool = new Sqlite3QuerierPool(':memory:', undefined, { listeners: [listener] });
  let querier: PooledQuerier;

  beforeEach(async () => {
    log = [];
    querier = await listenerPool.getQuerier();
    await createTable(querier, 'Book');
    await createTable(querier, 'Plain');
  });

  afterEach(() => querier.release());

  afterAll(() => listenerPool.end());

  it('should fire before the entity hooks, and see the rows a delete is taking', async () => {
    await querier.insertOne(Book, { title: 'Watched' });
    log = [];

    await querier.deleteOneById(Book, 1);

    expect(log).toEqual(['listener:Book:Watched', 'beforeDelete:Watched', 'afterDelete:Watched']);
  });

  it('should be awaited, and reached by an entity with no hooks of its own', async () => {
    await querier.insertOne(Plain, { title: 'p' });

    // Logged by the time `insertOne` resolved, so the 5ms listener was waited for, not left running.
    expect(log).toEqual(['listener:awaited']);
  });
});
