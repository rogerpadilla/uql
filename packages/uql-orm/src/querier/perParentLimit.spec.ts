import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';
import { getMeta } from '../entity/index.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { idKey } from '../type/index.js';
import type { QueryUpdateResult, RawRow, Type } from '../type/index.js';
import type { ParentJoin, ParentPartition } from '../util/relationQuery.util.js';
import { AbstractSqlQuerier } from './abstractSqlQuerier.js';

@Entity()
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string;
  @Field({ references: () => Blog }) blogId?: number;
  @ManyToOne({ entity: () => Blog }) blog?: Blog;
}

@Entity()
class Blog {
  @Id({ type: Number }) id?: number;
  @OneToMany({ entity: () => Post, mappedBy: 'blog' }) posts?: Post[];
  @ManyToMany({ entity: () => Tag, through: () => BlogTag }) tags?: Tag[];
}

@Entity()
class Tag {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

@Entity()
class BlogTag {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Blog }) blogId?: number;
  @Field({ references: () => Tag }) tagId?: number;
}

/** Two-column key, to pin that each branch compares every column of a composite parent key. */
@Entity()
class Region {
  [idKey]?: 'country' | 'area';
  @Id({ type: String }) country?: string;
  @Id({ type: String }) area?: string;
  @OneToMany({ entity: () => City, mappedBy: 'region' }) cities?: City[];
}

@Entity()
class City {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) cityCountry?: string;
  @Field({ type: String }) cityArea?: string;
  @ManyToOne({
    entity: () => Region,
    references: [
      { local: 'cityCountry', foreign: 'country' },
      { local: 'cityArea', foreign: 'area' },
    ],
  })
  region?: Region;
}

/** Records every statement, and replays canned rows so a populate can be driven without a database. */
class RecordingQuerier extends AbstractSqlQuerier {
  readonly statements: { sql: string; values: unknown[] }[] = [];
  queue: RawRow[][] = [];

  constructor() {
    super(new SqliteDialect({}));
  }

  protected override async internalAll<T>(query: string, values?: unknown[]): Promise<T[]> {
    this.statements.push({ sql: query, values: values ?? [] });
    return (this.queue.shift() ?? []) as T[];
  }

  protected override async *internalStream<T>(): AsyncIterable<T> {}

  protected override async internalRun(): Promise<QueryUpdateResult> {
    return { changes: 0 };
  }

  protected override async internalRelease(): Promise<void> {}

  /** The statement that loaded the relation, which is always the one after the parents' own. */
  relationStatement() {
    return this.statements[1];
  }
}

/**
 * The Postgres family swaps the `UNION ALL` of branches for one `LATERAL` correlated against an array
 * of the parent keys. Pinned on the dialect directly: the row source and the branch it joins have to
 * name the same alias, and nothing else would catch them drifting apart.
 */
describe('per-parent limits: the LATERAL shape', () => {
  const partitionOf = (entity: Type<object>, joins: ParentJoin[], parents: unknown[]): ParentPartition => ({
    joins,
    parents,
    parentFields: getMeta(entity).fields as ParentPartition['parentFields'],
  });

  it('should correlate one branch against an array of the parent keys', () => {
    const dialect = new PostgresDialect();
    const ctx = dialect.createContext();

    dialect.findPerParent(
      ctx,
      Post,
      { $select: { body: true }, $sort: { id: -1 }, $limit: 3 },
      partitionOf(Blog, [{ parent: 'id', joined: 'blogId' }], [{ id: 7 }, { id: 9 }]),
    );

    expect(ctx.sql).toBe(
      'SELECT "_uql_p_2".* FROM UNNEST($1::BIGINT[]) AS "_uql_keys_1"(k0)' +
        ' JOIN LATERAL (SELECT "body" FROM "Post" WHERE "blogId" = "_uql_keys_1".k0 ORDER BY "id" DESC LIMIT 3)' +
        ' "_uql_p_2" ON TRUE',
    );
    // One parameter whatever the page size, so the text stops varying with the parent count.
    expect(ctx.values).toEqual([[7, 9]]);
  });

  it('should pair one array per column of a composite parent key', () => {
    const dialect = new PostgresDialect();
    const ctx = dialect.createContext();

    dialect.findPerParent(
      ctx,
      City,
      { $select: { id: true }, $limit: 1 },
      partitionOf(
        Region,
        [
          { parent: 'country', joined: 'cityCountry' },
          { parent: 'area', joined: 'cityArea' },
        ],
        [{ country: 'es', area: 'north' }],
      ),
    );

    // `UNNEST` pairs the arrays rather than cross-producting them, so a pairing no parent has is never
    // asked for - unlike the flat read, which over-selects and leans on the regroup to drop it.
    expect(ctx.sql).toContain('UNNEST($1::TEXT[], $2::TEXT[]) AS "_uql_keys_1"(k0, k1)');
    expect(ctx.sql).toContain('WHERE "cityCountry" = "_uql_keys_1".k0 AND "cityArea" = "_uql_keys_1".k1');
    expect(ctx.values).toEqual([['es'], ['north']]);
  });

  it('should refuse to page by a parent key the parent entity does not have', () => {
    const dialect = new PostgresDialect();
    expect(() =>
      dialect.findPerParent(
        dialect.createContext(),
        Post,
        { $limit: 1 },
        partitionOf(Blog, [{ parent: 'nope', joined: 'blogId' }], [{ nope: 7 }]),
      ),
    ).toThrow("cannot page a relation per parent: 'nope' is not a field of the parent entity");
  });

  it('should refuse a bounded read for no parents at all, rather than emit an empty statement', () => {
    const dialect = new PostgresDialect();
    expect(() =>
      dialect.findPerParent(
        dialect.createContext(),
        Post,
        { $limit: 1 },
        partitionOf(Blog, [{ parent: 'id', joined: 'blogId' }], []),
      ),
    ).toThrow('cannot read a bounded relation for no parents at all');
  });

  /** MySQL has `LATERAL` and plans it worse than its own `UNION ALL`, so it stays on the default. */
  it('should leave the MySQL family on the UNION ALL shape', () => {
    const dialect = new MySqlDialect();
    const ctx = dialect.createContext();

    dialect.findPerParent(
      ctx,
      Post,
      { $select: { body: true }, $limit: 1 },
      partitionOf(Blog, [{ parent: 'id', joined: 'blogId' }], [{ id: 7 }]),
    );

    expect(ctx.sql).not.toContain('LATERAL');
    expect(ctx.sql).toContain('SELECT * FROM (');
  });
});

describe('per-parent limits', () => {
  const givenBlogs = (querier: RecordingQuerier, ...ids: number[]) => {
    querier.queue = [ids.map((id) => ({ id })), []];
  };

  it('should emit one bounded branch per parent, wrapped and concatenated', async () => {
    const querier = new RecordingQuerier();
    givenBlogs(querier, 7, 9);

    await querier.findMany(Blog, { $populate: { posts: { $sort: { id: -1 }, $limit: 3 } } });

    expect(querier.relationStatement().sql).toBe(
      'SELECT * FROM (SELECT `id`, `body`, `blogId` FROM `Post` WHERE `blogId` = ? ORDER BY `id` DESC LIMIT 3) `_uql_p_1`' +
        ' UNION ALL ' +
        'SELECT * FROM (SELECT `id`, `body`, `blogId` FROM `Post` WHERE `blogId` = ? ORDER BY `id` DESC LIMIT 3) `_uql_p_2`',
    );
    expect(querier.relationStatement().values).toEqual([7, 9]);
  });

  /**
   * The wrapper is not decoration: SQLite rejects `ORDER BY`/`LIMIT` on a bare parenthesised compound
   * branch with `near "(": syntax error`.
   */
  it('should wrap every branch in its own derived table', async () => {
    const querier = new RecordingQuerier();
    givenBlogs(querier, 1, 2, 3);

    await querier.findMany(Blog, { $populate: { posts: { $limit: 1 } } });

    const branches = querier.relationStatement().sql.split(' UNION ALL ');
    expect(branches).toHaveLength(3);
    expect(branches.map((branch) => branch.startsWith('SELECT * FROM ('))).toEqual([true, true, true]);
    expect(branches.map((branch) => branch.endsWith('LIMIT 1) `_uql_p_1`'))).toEqual([true, false, false]);
  });

  it('should give each parent its own OFFSET rather than one across the page', async () => {
    const querier = new RecordingQuerier();
    givenBlogs(querier, 4, 5);

    await querier.findMany(Blog, { $populate: { posts: { $sort: { id: 1 }, $limit: 2, $skip: 10 } } });

    const offsets = querier.relationStatement().sql.match(/LIMIT 2 OFFSET 10/g);
    expect(offsets).toHaveLength(2);
  });

  it('should compare every column of a composite parent key in each branch', async () => {
    const querier = new RecordingQuerier();
    querier.queue = [
      [
        { country: 'es', area: 'north' },
        { country: 'pt', area: 'south' },
      ],
      [],
    ];

    await querier.findMany(Region, { $populate: { cities: { $limit: 1 } } });

    const { sql, values } = querier.relationStatement();
    expect(sql.match(/WHERE `cityCountry` = \? AND `cityArea` = \?/g)).toHaveLength(2);
    expect(values).toEqual(['es', 'north', 'pt', 'south']);
  });

  /** Without `$limit`/`$skip` there is nothing to bound, and the flat `IN (...)` read is cheaper. */
  it('should keep the flat statement when the relation asks for no share of its own', async () => {
    const querier = new RecordingQuerier();
    givenBlogs(querier, 7, 9);

    await querier.findMany(Blog, { $populate: { posts: { $sort: { id: -1 } } } });

    expect(querier.relationStatement().sql).not.toContain('UNION ALL');
    expect(querier.relationStatement().sql).toContain('`blogId` IN (?, ?)');
  });

  it('should bound a many-to-many per parent over its junction', async () => {
    const querier = new RecordingQuerier();
    givenBlogs(querier, 7, 9);

    await querier.findMany(Blog, { $populate: { tags: { $limit: 2 } } });

    const { sql, values } = querier.relationStatement();
    expect(sql.split(' UNION ALL ')).toHaveLength(2);
    expect(sql.match(/WHERE `BlogTag`\.`blogId` = \?/g)).toHaveLength(2);
    expect(values).toEqual([7, 9]);
  });

  /**
   * Ordering and paging describe the junction statement, which has one row per pairing. Spread onto
   * the target's populate instead they reached a to-one join, which rejects all four by name - so a
   * many-to-many carrying any of `$sort`, `$limit`, `$skip` or `$distinct` threw instead of paging.
   */
  it('should order a many-to-many by a target column', async () => {
    const querier = new RecordingQuerier();
    givenBlogs(querier, 7);

    await querier.findMany(Blog, { $populate: { tags: { $sort: { name: 1 } } } });

    expect(querier.relationStatement().sql).toContain('ORDER BY');
    expect(querier.relationStatement().sql).toContain('`name`');
  });

  it('should issue no statement at all when the page has no parents', async () => {
    const querier = new RecordingQuerier();
    querier.queue = [[]];

    await querier.findMany(Blog, { $populate: { posts: { $limit: 3 } } });

    expect(querier.statements).toHaveLength(1);
  });
});
