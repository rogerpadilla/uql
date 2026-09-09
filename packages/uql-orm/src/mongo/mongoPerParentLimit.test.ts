import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { provisioningTimeout } from '../test/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

@Entity()
class MplBlog {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) name?: string;
  @OneToMany({ entity: () => MplPost, mappedBy: 'mplBlog' }) posts?: MplPost[];
}

@Entity()
class MplPost {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) title?: string;
  @Field({ type: Number }) rank?: number;
  @Field({ references: () => MplBlog }) mplBlogId?: string;
  @ManyToOne({ entity: () => MplBlog }) mplBlog?: MplBlog;
}

/**
 * The `$unionWith` shape against a real `mongod`. Only the server can say the pipeline is accepted,
 * that each sub-pipeline bounds its own parent, and that the rows come back attributed correctly -
 * a flat `$limit` handed one parent's share to whichever parents happened to own the rows.
 */
describe('per-parent limits (MongoDB)', () => {
  let replSet: MongoMemoryReplSet;
  let pool: MongodbQuerierPool;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    pool = new MongodbQuerierPool(replSet.getUri());
    for (const name of ['a', 'b', 'c']) {
      const blogId = await pool.insertOne(MplBlog, { name });
      for (let rank = 1; rank <= 5; rank++) {
        await pool.insertOne(MplPost, { title: `${name}${rank}`, rank, mplBlogId: blogId as string });
      }
    }
    await pool.insertOne(MplBlog, { name: 'empty' });
    const thin = await pool.insertOne(MplBlog, { name: 'thin' });
    await pool.insertOne(MplPost, { title: 'thin1', rank: 1, mplBlogId: thin as string });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.end();
    await replSet.stop({ doCleanup: false });
    try {
      await replSet.cleanup();
    } catch {
      // the OS reaps the process; cleanup races in mongodb-memory-server
    }
  }, provisioningTimeout);

  const titlesByBlog = (blogs: MplBlog[]) =>
    Object.fromEntries(blogs.map((blog) => [blog.name, blog.posts?.map((post) => post.title)]));

  it('should give every parent its own newest N in one pipeline', async () => {
    const blogs = await pool.findMany(MplBlog, {
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
    const blogs = await pool.findMany(MplBlog, {
      $select: { name: true },
      $sort: { name: 1 },
      $populate: { posts: { $select: { title: true }, $sort: { rank: 1 }, $limit: 2, $skip: 2 } },
    });

    expect(titlesByBlog(blogs)).toEqual({
      a: ['a3', 'a4'],
      b: ['b3', 'b4'],
      c: ['c3', 'c4'],
      empty: [],
      thin: [],
    });
  });

  it('should still filter inside each parent share', async () => {
    const blogs = await pool.findMany(MplBlog, {
      $select: { name: true },
      $sort: { name: 1 },
      $where: { name: { $in: ['a', 'b'] } },
      $populate: { posts: { $select: { title: true }, $where: { rank: { $lte: 3 } }, $sort: { rank: -1 }, $limit: 2 } },
    });

    expect(titlesByBlog(blogs)).toEqual({ a: ['a3', 'a2'], b: ['b3', 'b2'] });
  });

  /**
   * Above MongoDB's 1000-stage pipeline cap - bisected exactly: 1000 accepted, 1001 refused, and a
   * sub-pipeline's own stages do not count toward it. One `$unionWith` per parent after the first puts
   * a page this wide over the line, so it has to fall back to a query each and still bound every
   * parent separately.
   */
  it(
    'should fall back to a query each past the pipeline cap, still bounded per parent',
    async () => {
      const blogs = Array.from({ length: 1000 }, (_, i) => ({ name: `wide${i}` }));
      const ids = await pool.insertMany(MplBlog, blogs);
      await pool.insertMany(
        MplPost,
        ids.flatMap((id, i) => [
          { title: `w${i}-lo`, rank: 1, mplBlogId: id as string },
          { title: `w${i}-hi`, rank: 2, mplBlogId: id as string },
        ]),
      );

      const found = await pool.findMany(MplBlog, {
        $select: { name: true },
        $where: { name: { $like: 'wide%' } },
        $populate: { posts: { $select: { title: true }, $sort: { rank: -1 }, $limit: 1 } },
      });

      expect(found).toHaveLength(1000);
      // Every parent its own newest one - not a share of a single page, and not two.
      const shares = found.map((blog) => blog.posts?.map((post) => post.title));
      expect(shares.every((share) => share?.length === 1)).toBe(true);
      expect(shares.every((share) => share?.[0]?.endsWith('-hi'))).toBe(true);
    },
    provisioningTimeout,
  );

  it('should return every child when the relation asks for no share of its own', async () => {
    const blogs = await pool.findMany(MplBlog, {
      $select: { name: true },
      $where: { name: 'a' },
      $populate: { posts: { $select: { title: true }, $sort: { rank: 1 } } },
    });

    expect(blogs[0].posts?.map((post) => post.title)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
  });
});
