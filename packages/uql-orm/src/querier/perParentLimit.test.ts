import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrdbQuerierPool } from '../cockroachdb/crdbQuerierPool.js';
import { Entity, Field, Id, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';
import { MariadbQuerierPool } from '../maria/mariadbQuerierPool.js';
import { Migrator } from '../migrate/migrator.js';
import { MySql2QuerierPool } from '../mysql/mysql2QuerierPool.js';
import { PgQuerierPool } from '../postgres/pgQuerierPool.js';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { provisioningTimeout } from '../test/index.js';
import type { SqlQuerierPool } from '../type/index.js';

@Entity()
class PplBlog {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @OneToMany({ entity: () => PplPost, mappedBy: 'pplBlog' }) posts?: PplPost[];
  @ManyToMany({ entity: () => PplTag, through: () => PplBlogTag }) tags?: PplTag[];
}

@Entity()
class PplPost {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ type: Number }) rank?: number;
  @Field({ references: () => PplBlog }) pplBlogId?: number;
  @ManyToOne({ entity: () => PplBlog }) pplBlog?: PplBlog;
}

@Entity()
class PplTag {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

@Entity()
class PplBlogTag {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => PplBlog }) pplBlogId?: number;
  @Field({ references: () => PplTag }) pplTagId?: number;
}

const databases: { name: string; createPool: () => SqlQuerierPool }[] = [
  {
    name: 'PostgreSQL',
    createPool: () =>
      new PgQuerierPool({ host: '0.0.0.0', port: 5442, user: 'test', password: 'test', database: 'test' }),
  },
  {
    name: 'MySQL',
    createPool: () =>
      new MySql2QuerierPool({ host: '0.0.0.0', port: 3316, user: 'test', password: 'test', database: 'test' }),
  },
  {
    name: 'MariaDB',
    createPool: () =>
      new MariadbQuerierPool({ host: '0.0.0.0', port: 3326, user: 'test', password: 'test', database: 'test' }),
  },
  {
    // The shape has to hold on every engine, and CockroachDB is the one whose planner is closest to
    // Postgres while its execution is not - so a `UNION ALL` of bounded branches is worth proving here
    // rather than assumed from the Postgres run.
    name: 'CockroachDB',
    createPool: () => new CrdbQuerierPool({ host: '0.0.0.0', port: 26257, user: 'root', database: 'defaultdb' }),
  },
  { name: 'SQLite', createPool: () => new Sqlite3QuerierPool(':memory:') },
];

/**
 * A `$limit` inside a to-many `$populate` used to cap the whole result set, so the newest three rows
 * of the page were handed to whichever parents owned them and every other parent got `[]` - which
 * reads exactly like having no children. Only a real engine can say the `UNION ALL` of bounded
 * branches parses, orders and pages the way each dialect spells it.
 */
for (const db of databases) {
  describe(`per-parent limits (${db.name})`, () => {
    const pool = db.createPool();

    beforeAll(async () => {
      await new Migrator(pool, { entities: [PplBlog, PplPost, PplTag, PplBlogTag] }).sync({
        force: true,
        logging: false,
      });
      // Three blogs, five posts each, ranked so the newest are predictable per blog.
      for (const blogName of ['a', 'b', 'c']) {
        const pplBlogId = await pool.insertOne(PplBlog, { name: blogName });
        for (let rank = 1; rank <= 5; rank++) {
          await pool.insertOne(PplPost, { title: `${blogName}${rank}`, rank, pplBlogId: pplBlogId as number });
        }
      }
      // A fourth blog with no posts at all, and one with fewer than the limit.
      await pool.insertOne(PplBlog, { name: 'empty' });
      const thin = await pool.insertOne(PplBlog, { name: 'thin' });
      await pool.insertOne(PplPost, { title: 'thin1', rank: 1, pplBlogId: thin as number });

      for (const tagName of ['x', 'y', 'z']) {
        const pplTagId = await pool.insertOne(PplTag, { name: tagName });
        for (const blogName of ['a', 'b']) {
          const [blog] = await pool.findMany(PplBlog, { $select: { id: true }, $where: { name: blogName } });
          await pool.insertOne(PplBlogTag, { pplBlogId: blog.id, pplTagId: pplTagId as number });
        }
      }
    }, provisioningTimeout);

    afterAll(async () => {
      await pool.end();
    }, provisioningTimeout);

    const titlesByBlog = (blogs: PplBlog[]) =>
      Object.fromEntries(blogs.map((blog) => [blog.name, blog.posts?.map((post) => post.title)]));

    it('should give every parent its own newest N, not a share of one page', async () => {
      const blogs = await pool.findMany(PplBlog, {
        $select: { name: true },
        $sort: { name: 1 },
        $populate: { posts: { $select: { title: true }, $sort: { rank: -1 }, $limit: 2 } },
      });

      expect(titlesByBlog(blogs)).toEqual({
        a: ['a5', 'a4'],
        b: ['b5', 'b4'],
        c: ['c5', 'c4'],
        empty: [],
        thin: ['thin1'],
      });
    });

    it('should page each parent independently with $skip', async () => {
      const blogs = await pool.findMany(PplBlog, {
        $select: { name: true },
        $sort: { name: 1 },
        $populate: { posts: { $select: { title: true }, $sort: { rank: 1 }, $limit: 2, $skip: 2 } },
      });

      expect(titlesByBlog(blogs)).toEqual({
        a: ['a3', 'a4'],
        b: ['b3', 'b4'],
        c: ['c3', 'c4'],
        empty: [],
        // Only one post, so a skip of two leaves nothing - not a borrowed row from another parent.
        thin: [],
      });
    });

    it('should still filter and project inside each parent share', async () => {
      const blogs = await pool.findMany(PplBlog, {
        $select: { name: true },
        $sort: { name: 1 },
        $where: { name: { $in: ['a', 'b'] } },
        $populate: {
          posts: { $select: { title: true }, $where: { rank: { $lte: 3 } }, $sort: { rank: -1 }, $limit: 2 },
        },
      });

      expect(titlesByBlog(blogs)).toEqual({ a: ['a3', 'a2'], b: ['b3', 'b2'] });
    });

    it('should bound a many-to-many per parent', async () => {
      const blogs = await pool.findMany(PplBlog, {
        $select: { name: true },
        $sort: { name: 1 },
        $where: { name: { $in: ['a', 'b'] } },
        $populate: { tags: { $select: { name: true }, $sort: { name: 1 }, $limit: 2 } },
      });

      expect(Object.fromEntries(blogs.map((blog) => [blog.name, blog.tags?.map((tag) => tag.name)]))).toEqual({
        a: ['x', 'y'],
        b: ['x', 'y'],
      });
    });

    /** The whole page's worth when nothing bounds it, which is the cheaper flat statement. */
    it('should return every child when the relation asks for no share of its own', async () => {
      const blogs = await pool.findMany(PplBlog, {
        $select: { name: true },
        $where: { name: 'a' },
        $populate: { posts: { $select: { title: true }, $sort: { rank: 1 } } },
      });

      expect(blogs[0].posts?.map((post) => post.title)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    });
  });
}
