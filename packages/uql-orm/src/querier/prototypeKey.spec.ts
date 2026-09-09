import { describe, expect, it } from 'vitest';
import { COUNT_ALIAS } from '../dialect/aliases.js';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { COUNT_RESULT_KEY, type Querier, type QueryUpdateResult, type RawRow } from '../type/index.js';
import { AbstractSqlQuerier } from './abstractSqlQuerier.js';
import { fillRelationCounts } from './relationCount.js';

/**
 * A string primary key is data, so a row can carry a value that spells a member of `Object.prototype`.
 * Grouping children under one used to throw `push is not a function`, and a tally under one read back
 * as an object; `dataKeyed` is what makes them ordinary keys. Its own unit tests prove the lookup
 * behaves - these prove the read paths actually use it.
 */
@Entity()
class Tag {
  @Id({ type: String }) slug?: string;
  @OneToMany({ entity: () => Item, mappedBy: 'tag' }) items?: Item[];
}

@Entity()
class Item {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) label?: string;
  @Field({ references: () => Tag }) tagId?: string;
  @ManyToOne({ entity: () => Tag }) tag?: Tag;
}

/** Replays canned rows so a populate runs without a database. */
class CannedQuerier extends AbstractSqlQuerier {
  queue: RawRow[][] = [];

  constructor() {
    super(new SqliteDialect({}));
  }

  protected override async internalAll<T>(): Promise<T[]> {
    return (this.queue.shift() ?? []) as T[];
  }

  protected override async *internalStream<T>(): AsyncIterable<T> {}

  protected override async internalRun(): Promise<QueryUpdateResult> {
    return { changes: 0 };
  }

  protected override async internalRelease(): Promise<void> {}
}

const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

describe('a key that spells a prototype member', () => {
  it.each(PROTOTYPE_KEYS)('populates a to-many under %s', async (slug) => {
    const querier = new CannedQuerier();
    querier.queue = [
      [{ slug }],
      [
        { id: 1, label: 'a', tagId: slug },
        { id: 2, label: 'b', tagId: slug },
      ],
    ];

    const found = await querier.findMany(Tag, { $select: { slug: true }, $populate: { items: true } });

    expect(found).toHaveLength(1);
    expect(found[0].items?.map((item) => item.label)).toEqual(['a', 'b']);
  });

  it('keeps two such parents apart instead of pooling their children', async () => {
    const querier = new CannedQuerier();
    querier.queue = [
      [{ slug: '__proto__' }, { slug: 'constructor' }],
      [
        { id: 1, label: 'proto', tagId: '__proto__' },
        { id: 2, label: 'ctor', tagId: 'constructor' },
      ],
    ];

    const found = await querier.findMany(Tag, { $select: { slug: true }, $populate: { items: true } });

    expect(found.map((tag) => tag.items?.map((item) => item.label))).toEqual([['proto'], ['ctor']]);
  });

  it('leaves a parent with no children an empty list, not a prototype member', async () => {
    const querier = new CannedQuerier();
    querier.queue = [[{ slug: 'toString' }], []];

    const found = await querier.findMany(Tag, { $select: { slug: true }, $populate: { items: true } });

    expect(found[0].items).toEqual([]);
  });

  it.each(PROTOTYPE_KEYS)('counts a to-many under %s as a number', async (slug) => {
    const payload = [{ slug }] as Tag[];
    const querier = {
      aggregate: async () => [{ tagId: slug, [COUNT_ALIAS]: 3 }],
      findMany: async () => [],
    } as unknown as Pick<Querier, 'aggregate' | 'findMany'>;

    await fillRelationCounts(querier, Tag, payload, { items: true });

    const counts = (payload[0] as Record<string, unknown>)[COUNT_RESULT_KEY] as { items: number };
    expect(counts.items).toBe(3);
  });

  it('counts a parent the tallies never named as zero', async () => {
    const payload = [{ slug: '__proto__' }] as Tag[];
    const querier = {
      aggregate: async () => [],
      findMany: async () => [],
    } as unknown as Pick<Querier, 'aggregate' | 'findMany'>;

    await fillRelationCounts(querier, Tag, payload, { items: true });

    const counts = (payload[0] as Record<string, unknown>)[COUNT_RESULT_KEY] as { items: number };
    expect(counts.items).toBe(0);
  });
});
