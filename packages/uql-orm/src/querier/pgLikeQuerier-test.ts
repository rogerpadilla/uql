import { expect } from 'vitest';
import { Company, NarrowVectorItem, Profile, User } from '../test/index.js';
import { VectorQuerierIt } from './vectorQuerier-test.js';

/**
 * Shared expectations for Postgres-wire dialects with native JSONB support (Postgres, CockroachDB) -
 * both implement the JSONB operators identically, so these tests run unmodified on either. The
 * vector expectations they also share with libSQL and Turso live in {@link VectorQuerierIt}.
 */
export abstract class PgLikeQuerierIt extends VectorQuerierIt {
  /**
   * A JSONB dot-path two levels deep (`kind.meta.count`). The single-level array/elemMatch/set/
   * push/unset paths are already covered generically for every dialect in {@link AbstractQuerierIt}.
   */
  async shouldFindByDeepJsonbDotPath() {
    await this.querier.insertOne(Company, {
      name: 'Test Company',
      kind: { meta: { count: 5 } },
    });

    const found = await this.querier.findMany(Company, {
      $where: { 'kind.meta.count': { $gt: 0 } },
    });
    expect(found).toHaveLength(1);
  }

  /**
   * `halfvec` and `sparsevec` round-tripping through a real database, insert included. Both used to
   * bind as plain arrays there, and `sparsevec` additionally needs pgvector's sparse literal - two
   * failures no assertion on generated SQL could see. CockroachDB has neither type and lands both on
   * `vector`, which is exactly why the same test has to pass on both.
   */
  async shouldRoundTripNarrowVectorTypes() {
    const id = await this.querier.insertOne(NarrowVectorItem, {
      name: 'narrow',
      half: [1, 0, 0],
      sparse: [0, 0, 1],
    });

    const found = await this.querier.findOneById(NarrowVectorItem, id);

    expect(found!.name).toBe('narrow');
    // Both come back dense, whichever literal the engine stored them as: `sparsevec` is a storage
    // format, and the field type promises the same array on the way out as on the way in.
    expect(found!.half).toEqual([1, 0, 0]);
    expect(found!.sparse).toEqual([0, 0, 1]);
  }

  async shouldSortByNarrowVectorDistance() {
    await this.querier.insertMany(NarrowVectorItem, [
      { name: 'near', half: [1, 0, 0], sparse: [1, 0, 0] },
      { name: 'far', half: [0, 1, 0], sparse: [0, 1, 0] },
    ]);

    const byHalf = await this.querier.findMany(NarrowVectorItem, {
      $select: { name: true },
      $sort: { half: { $vector: [1, 0, 0] } },
    });
    const bySparse = await this.querier.findMany(NarrowVectorItem, {
      $select: { name: true },
      $sort: { sparse: { $vector: [1, 0, 0], $distance: 'l2' } },
    });

    expect(byHalf.map((r) => r.name)).toEqual(['near', 'far']);
    expect(bySparse.map((r) => r.name)).toEqual(['near', 'far']);
  }
  /**
   * A cascade has to delete the children before the parent, because the children hold the foreign key.
   * Nothing else in the suite can catch a wrong order: `createTables` builds the fixtures without
   * constraints on purpose, so an out-of-order delete succeeds there and only fails on a real schema.
   * This adds the constraint for the duration of the test and takes it back off.
   */
  async shouldCascadeDeleteChildrenBeforeParent() {
    const id = await this.querier.insertOne(User, { createdAt: 1, profile: { createdAt: 1 } });
    await this.querier.run(
      'ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_creator_fk" FOREIGN KEY ("creatorId") REFERENCES "User" ("id")',
    );

    try {
      expect(await this.querier.deleteOneById(User, id)).toBe(1);
      expect(await this.querier.findMany(Profile, { $where: { creatorId: id } })).toHaveLength(0);
      expect(await this.querier.findMany(User, { $where: { id } })).toHaveLength(0);
    } finally {
      await this.querier.run('ALTER TABLE "user_profile" DROP CONSTRAINT "user_profile_creator_fk"');
    }
  }
  /**
   * `onDelete: 'CASCADE'` hands the cascade to the database, so deleting the parent is one statement
   * rather than the graph walk `cascade: 'delete'` performs. Asserted against a real constraint with
   * `ON DELETE CASCADE`, since that is the only place the behaviour exists.
   */
  async shouldLetTheDatabaseCascadeWhenOnDeleteIsDeclared() {
    const id = await this.querier.insertOne(User, { createdAt: 1, profile: { createdAt: 1 } });
    await this.querier.run(
      'ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_creator_cascade_fk"' +
        ' FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE',
    );

    try {
      // Bypasses `deleteMany` deliberately: this asserts what the constraint does on its own, which is
      // what a user gets once the relation declares `onDelete` and drops `cascade`.
      const { changes } = await this.querier.run('DELETE FROM "User" WHERE "id" = $1', [id]);
      expect(changes).toBe(1);
      expect(await this.querier.findMany(Profile, { $where: { creatorId: id } })).toHaveLength(0);
    } finally {
      await this.querier.run('ALTER TABLE "user_profile" DROP CONSTRAINT "user_profile_creator_cascade_fk"');
    }
  }
}
