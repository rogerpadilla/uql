import { expect } from 'vitest';
import { withContext } from '../context/context.js';
import { Entity, Field, getEntities, getMeta, Id } from '../entity/index.js';
import { AbstractQuerierIt } from '../querier/abstractQuerier-test.js';
import { assertDefined, createSpec, MeasureUnitCategory, mongoUri, Profile, TypedRow, User } from '../test/index.js';
import { raw } from '../util/index.js';
import type { MongodbQuerier } from './mongodbQuerier.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

/** A string key left to the driver, so MongoDB mints the `ObjectId` and the read converts it. */
@Entity()
class Ticket {
  @Id({ type: String })
  id?: string;

  @Field({ type: String })
  subject?: string | null;
}

/** Two vectors, of which `$vectorSearch` can rank by only one. */
@Entity()
class TwoVectorDoc {
  @Id({ type: String }) id?: string;
  @Field({ type: 'vector', dimensions: 2 }) title?: number[] | null;
  @Field({ type: 'vector', dimensions: 2 }) body?: number[] | null;
}

class MongodbQuerierIt extends AbstractQuerierIt<MongodbQuerier> {
  override async recreateTables(querier: MongodbQuerier) {
    await querier.db.dropDatabase();
    await Promise.all(
      getEntities().map((entity) => {
        const { name } = getMeta(entity);
        assertDefined(name);
        return querier.db.createCollection(name);
      }),
    );
  }

  /** For good, and under a system context, so neither a soft delete nor the tenant filter leaves a row behind. */
  override async clearTables() {
    await withContext({ system: true }, () =>
      Promise.all(
        getEntities().map((entity) => this.querier.deleteMany(entity, {}, { unfiltered: true, hardDelete: true })),
      ),
    );
  }

  /** MongoDB's reply tells an upsert's insert from its update. */
  protected override upsertReport(inserted: number, updated: number) {
    return { ...super.upsertReport(inserted, updated), created: updated === 0 };
  }

  /**
   * A wide integer stays exact, as every SQL driver keeps it: a `BigInt` field reads back as one, `$inc`
   * included, and a number past 2^53 in any other field as its exact text rather than a rounded number.
   */
  async shouldKeepAWideIntegerExact() {
    const id = await this.querier.insertOne(TypedRow, { id: 1, name: 'wide', wide: 9007199254740993n });
    await this.querier.updateOneById(TypedRow, id, { wide: { $inc: 1n } });
    const collection = this.querier.db.collection<{ _id: number; count?: bigint }>('TypedRow');
    await collection.updateOne({ _id: 1 }, { $set: { count: 9007199254740993n } });

    const found = await this.querier.findOneById(TypedRow, id, { $select: { wide: true, count: true } });

    expect(found).toEqual({ wide: 9007199254740994n, count: '9007199254740993' });
  }

  /** An aggregate decodes as a document does: a total over a `BigInt` field a `bigint`, over any other the number it is. */
  async shouldTotalAWideIntegerAsItsField() {
    const collection = this.querier.db.collection<{ _id: number; name: string; count: bigint; wide: bigint }>(
      'TypedRow',
    );
    await collection.insertMany([
      { _id: 1, name: 'a', count: 5n, wide: 9007199254740993n },
      { _id: 2, name: 'a', count: 2n, wide: 1n },
    ]);

    const rows = await this.querier.aggregate(TypedRow, {
      $group: { name: true },
      $select: { total: { $sum: { count: true } }, wideTotal: { $sum: { wide: true } } },
    });

    expect(rows).toEqual([{ name: 'a', total: 7, wideTotal: 9007199254740994n }]);
  }

  /** A raw projection is SQL, which MongoDB refuses, a tally beside it included. */
  async shouldRefuseARawSelect() {
    await expect(
      this.querier.findMany(MeasureUnitCategory, { $select: [raw`name`], $count: { measureUnits: true } }),
    ).rejects.toThrow('raw() in $select is not supported on MongoDB');
  }

  /**
   * A key MongoDB minted pages by the `ObjectId` it is: the cursor carries its hex text, which has to reach
   * the next page's comparison as an `ObjectId` again, or it matches none, strings ordering apart.
   */
  async shouldPageByAKeyMongoDBMinted() {
    await this.querier.insertMany(
      Ticket,
      [1, 2, 3, 4, 5].map((at) => ({ subject: `ticket ${at}` })),
    );
    const q = { $select: { subject: true }, $sort: { id: 1 } } as const;

    const pages = await this.walkPages(Ticket, { ...q, $limit: 2 });

    expect(pages.flatMap((page) => page.items)).toEqual(await this.querier.findMany(Ticket, q));
  }

  /** A key the driver minted comes back as its hex string, the type the docs promise, not the `ObjectId` itself. */
  async shouldHandBackAMintedKeyAsAHexString() {
    const id = await this.querier.insertOne(Ticket, { subject: 'minted' });

    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(await this.querier.findOneById(Ticket, id, { $select: { subject: true } })).toEqual({
      subject: 'minted',
    });
  }

  /** Upserted on a field that is not the key, so only the database knows the id it minted. */
  async shouldReportTheIdAnUpsertMinted() {
    const { id } = await this.querier.upsertOne(Ticket, { subject: true }, { subject: 'upserted' });

    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(await this.querier.findOne(Ticket, { $select: { id: true }, $where: { subject: 'upserted' } })).toEqual({
      id,
    });
  }

  /** A payload of the key alone updates nothing it finds, and inserts the key where it finds none. */
  async shouldUpsertADocumentByItsKeyAlone() {
    const id = '65f0c0ffee0000000000beef';

    const inserted = await this.querier.upsertOne(Ticket, { id: true }, { id });
    const found = await this.querier.upsertOne(Ticket, { id: true }, { id });

    expect([inserted.id, inserted.created, found.id, found.created]).toEqual([id, true, id, false]);
    expect(await this.querier.findMany(Ticket, {})).toEqual([{ id }]);
  }

  /** The first vector a `$sort` names is lifted into `$vectorSearch`; a second has nothing left to rank it. */
  async shouldRefuseASecondVectorToRankBy() {
    await expect(
      this.querier.findMany(TwoVectorDoc, { $sort: { title: { $vector: [1, 0] }, body: { $vector: [0, 1] } } }),
    ).rejects.toThrow("cannot $sort by a second vector 'body' on MongoDB: $vectorSearch ranks by one");
  }

  /** `bulkWrite` names only the documents it inserted, so the one it updated is read back by `subject`. */
  async shouldReportEveryIdAnUpsertManyWrote() {
    const existingId = await this.querier.insertOne(Ticket, { subject: 'kept' });

    const { ids } = await this.querier.upsertMany(Ticket, { subject: true }, [
      { subject: 'kept' },
      { subject: 'fresh' },
    ]);

    const fresh = await this.querier.findOne(Ticket, { $select: { id: true }, $where: { subject: 'fresh' } });
    expect(ids).toEqual([existingId, fresh?.id]);
  }

  /**
   * A reference crosses both seams: written as the `ObjectId` the `$lookup` joins on, read back as
   * the same hex string the parent's own key reads as, so the two compare equal in code.
   */
  async shouldRoundTripAReferenceThroughTheWire() {
    const creatorId = await this.querier.insertOne(User, { name: 'creator', createdAt: 1 });
    await this.querier.insertOne(Profile, { picture: 'pic', createdAt: 1, creatorId });

    const user = await this.querier.findOneById(User, creatorId, {
      $populate: { profile: { $select: { picture: true } } },
    });
    expect(user?.profile).toMatchObject({ picture: 'pic' });

    const profile = await this.querier.findOne(Profile, { $select: { creatorId: true }, $where: { creatorId } });
    expect(profile?.creatorId).toBe(creatorId);
  }
}

createSpec(new MongodbQuerierIt(new MongodbQuerierPool(mongoUri('uql_querier'))));
