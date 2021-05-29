import { createSpec, InventoryAdjustment, normalizeSql, User } from '@uql/core/test';
import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { MySqlQuerier } from './mysqlQuerier';

class MySqlQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(MySqlQuerier, {
      query: () => Promise.resolve([{ insertId: 1 }]),
      release: () => Promise.resolve(),
    });
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await super.shouldInsertOneAndCascadeOneToOne();
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^INSERT INTO User \(name, createdAt\) VALUES \('some name', \d+\)$/)
    );
    expect(this.querier.query).nthCalledWith(
      2,
      expect.toMatch(/^INSERT INTO user_profile \(image, userId, createdAt\) VALUES \('abc', 1, \d+\)$/)
    );
  }

  async shouldInsertOneAndCascadeOneToMany() {
    await super.shouldInsertOneAndCascadeOneToMany();
    expect(this.querier.query).nthCalledWith(
      1,
      "INSERT INTO InventoryAdjustment (description, createdAt) VALUES ('some description', 1)"
    );
    expect(this.querier.query).nthCalledWith(
      2,
      'INSERT INTO ItemAdjustment (buyPrice, createdAt, inventoryAdjustmentId) VALUES (50, 1, 1), (300, 1, 1)'
    );
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    await super.shouldUpdateOneByIdAndCascadeOneToOne();
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE User SET name = 'something', updatedAt = \d+ WHERE id = 1$/)
    );
    expect(this.querier.query).nthCalledWith(
      2,
      expect.toMatch(/^UPDATE user_profile SET image = 'xyz', updatedAt = \d+ WHERE userId = 1$/)
    );
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    await super.shouldUpdateOneByIdAndCascadeOneToOneNull();
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE User SET name = 'something', updatedAt = \d+ WHERE id = 1$/)
    );
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    await super.shouldUpdateOneByIdAndCascadeOneToMany();
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE InventoryAdjustment SET description = 'some description', updatedAt = \d+ WHERE id = 1$/)
    );
    expect(this.querier.query).nthCalledWith(2, 'DELETE FROM ItemAdjustment WHERE inventoryAdjustmentId = 1');
    expect(this.querier.query).nthCalledWith(
      3,
      expect.toMatch(
        /^INSERT INTO ItemAdjustment \(buyPrice, inventoryAdjustmentId, createdAt\) VALUES \(50, 1, \d+\), \(300, 1, \d+\)$/
      )
    );
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    await super.shouldUpdateOneByIdAndCascadeOneToManyNull();
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE InventoryAdjustment SET description = 'some description', updatedAt = \d+ WHERE id = 1$/)
    );
  }
}

createSpec(new MySqlQuerierSpec());
