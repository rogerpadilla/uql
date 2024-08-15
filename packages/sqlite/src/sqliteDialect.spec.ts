import { Company, createSpec, Item, TaxCategory, User } from 'nukak/test';
import { AbstractSqlDialectSpec } from 'nukak/dialect/abstractSqlDialect-spec.js';
import { SqliteDialect } from './sqliteDialect.js';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  override shouldUpsert() {
    expect(
      this.dialect.upsert(
        TaxCategory,
        { pk: true },
        {
          pk: 'a',
          name: 'Some Name D',
          createdAt: 1,
          updatedAt: 1,
        },
      ),
    ).toBe(
      "INSERT OR IGNORE INTO `TaxCategory` (`pk`, `name`, `createdAt`, `updatedAt`) VALUES ('a', 'Some Name D', 1, 1); UPDATE `TaxCategory` SET `name` = 'Some Name D', `createdAt` = 1, `updatedAt` = 1 WHERE `pk` = 'a'",
    );
  }

  override shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      }),
    ).toBe(
      "SELECT `id` FROM `Item` WHERE `Item` MATCH {`name` `description`} : 'some text' AND `companyId` = 1 LIMIT 30",
    );

    expect(
      this.dialect.find(User, {
        $select: { id: 1 },
        $where: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: 1,
        },
        $limit: 10,
      }),
    ).toBe(
      "SELECT `id` FROM `User` WHERE `User` MATCH {`name`} : 'something' AND `name` <> 'other unwanted' AND `companyId` = 1 LIMIT 10",
    );
  }

  override shouldUpdateWithJsonbField() {
    expect(
      this.dialect.update(
        Company,
        { $where: { id: 1 } },
        {
          kind: { private: 1 },
          updatedAt: 123,
        },
      ),
    ).toBe('UPDATE `Company` SET `kind` = \'{"private":1}\'::jsonb, `updatedAt` = 123 WHERE `id` = 1');
  }
}

createSpec(new SqliteDialectSpec());
