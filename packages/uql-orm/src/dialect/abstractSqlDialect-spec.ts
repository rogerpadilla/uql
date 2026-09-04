import { expect } from 'vitest';
import { UqlSecurityError, withContext } from '../context/context.js';
import { Entity, Field, Filter, Id, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';
import {
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  MeasureUnit,
  Profile,
  type Spec,
  Tax,
  TaxCategory,
  User,
} from '../test/index.js';
import type { Query, QueryContext, QueryLockWait, Type, UpdatePayload } from '../type/index.js';
import { raw } from '../util/index.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';

/** Exercises a soft-delete stamp whose value is a raw SQL expression. */
@Entity()
class SoftDeleteRaw {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Date, softDelete: () => raw(() => 'NOW()') })
  deletedAt?: Date;
}

declare module '../type/index.js' {
  interface UqlContext {
    secureTenantId?: number;
  }
}

/** The joined (m1) side of a `security: true` filter - the regression case for the JOIN/populate gap. */
@Filter('tenant', {
  condition: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
  security: true,
})
@Entity()
class SecureRelated {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number;
  @Field({ type: String })
  name?: string;
}

@Entity()
class SecureParent {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureRelated })
  relatedId?: number;
  @ManyToOne({ entity: () => SecureRelated })
  related?: SecureRelated;
}

/** The relation-subquery target: a `security: true` filter and a soft-delete field must both scope it. */
@Filter('tenant', {
  condition: (ctx) => (ctx?.secureTenantId != null ? { tenantId: ctx.secureTenantId } : undefined),
  security: true,
})
@Entity()
class SecureChild {
  @Id({ type: Number })
  id?: number;
  @Field({ type: Number })
  tenantId?: number;
  @Field({ references: () => SecureCollection })
  collectionId?: number;
  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number;
  @ManyToOne({ entity: () => SecureCollection })
  collection?: SecureCollection;
}

/** No filters of its own, so a count over the junction to it stays junction-only. */
@Entity()
class PlainChild {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  collectionId?: number;
  @ManyToOne({ entity: () => SecureCollection })
  collection?: SecureCollection;
}

/** Junction FK names follow the derived `lowerFirst(entity) + Id` convention for mm relations. */
@Entity()
class SecureCollectionChild {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  secureCollectionId?: number;
  @Field({ references: () => SecureChild })
  secureChildId?: number;
}

@Entity()
class SecureCollectionPlain {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  secureCollectionId?: number;
  @Field({ references: () => PlainChild })
  plainChildId?: number;
}

/** Renamed PK/FK columns: a subquery must correlate on the columns, not the field keys. */
@Entity()
class RenamedParent {
  @Id({ type: Number, name: 'parent_pk' })
  id?: number;
  @OneToMany({ entity: () => RenamedChild, mappedBy: (child) => child.parentId })
  children?: RenamedChild[];
}

@Entity()
class RenamedChild {
  @Id({ type: Number })
  id?: number;
  @Field({ name: 'parent_fk', references: () => RenamedParent })
  parentId?: number;
}

/** Junction whose FK columns are renamed, so the mm form has to resolve them too. */
@Entity()
class SecureCollectionRenamed {
  @Id({ type: Number })
  id?: number;
  @Field({ name: 'renamed_collection', references: () => SecureCollection })
  secureCollectionId?: number;
  @Field({ name: 'renamed_child', references: () => SecureChild })
  secureChildId?: number;
}

/** A soft-deletable junction: an unlinked row must not count as a link. */
@Entity()
class SecureCollectionLink {
  @Id({ type: Number })
  id?: number;
  @Field({ references: () => SecureCollection })
  secureCollectionId?: number;
  @Field({ references: () => PlainChild })
  plainChildId?: number;
  @Field({ type: Number, softDelete: () => Date.now() })
  deletedAt?: number;
}

@Entity()
class SecureCollection {
  @Id({ type: Number })
  id?: number;
  @OneToMany({ entity: () => SecureChild, mappedBy: (child) => child.collectionId })
  children?: SecureChild[];
  @ManyToMany({ entity: () => SecureChild, through: () => SecureCollectionChild })
  taggedChildren?: SecureChild[];
  @ManyToMany({ entity: () => PlainChild, through: () => SecureCollectionPlain })
  plainChildren?: PlainChild[];
  @ManyToMany({ entity: () => PlainChild, through: () => SecureCollectionLink })
  linkedChildren?: PlainChild[];
  @ManyToMany({ entity: () => SecureChild, through: () => SecureCollectionRenamed })
  renamedChildren?: SecureChild[];
}

export type JsonUpdateCaseName =
  | 'set'
  | 'unsetOnly'
  | 'setUnsetCombined'
  | 'push'
  | 'pull'
  | 'pullPushSameKey'
  | 'setPushCombined'
  | 'setPushSameKey'
  | 'pushUnsetCombined';

/** The `kind` payload for each {@link JsonUpdateCaseName} - identical across every dialect. */
export const JSON_UPDATE_PAYLOADS: Record<JsonUpdateCaseName, UpdatePayload<Company>['kind']> = {
  set: { $set: { private: 1 } },
  unsetOnly: { $unset: ['public', 'private'] },
  setUnsetCombined: { $set: { private: 1 }, $unset: ['public'] },
  push: { $push: { tags: 'new-tag' } },
  pull: { $pull: { tags: 'a' } },
  pullPushSameKey: { $pull: { tags: 'a' }, $push: { tags: 'b' } },
  setPushCombined: { $set: { private: 1 }, $push: { tags: 'new-tag' } },
  setPushSameKey: { $set: { tags: ['a'] }, $push: { tags: 'b' } },
  pushUnsetCombined: { $push: { tags: 'new-tag' }, $unset: ['public'] },
};

export abstract class AbstractSqlDialectSpec implements Spec {
  constructor(readonly dialect: AbstractSqlDialect) {}

  protected exec(
    fn: (ctx: QueryContext) => void,
    dialect: AbstractSqlDialect = this.dialect,
  ): { sql: string; values: unknown[] } {
    const ctx = dialect.createContext();
    fn(ctx);
    return { sql: ctx.sql, values: ctx.values };
  }

  /** The `n`th bound-parameter placeholder: `?` for MySQL-family dialects, `$n` for Postgres-wire ones. */
  protected ph(n: number): string {
    return this.dialect.placeholder(n);
  }

  protected neSql(field: string, n = 1): string {
    const ph = this.ph(n);
    switch (this.dialect.dialectName) {
      case 'postgres':
      case 'cockroachdb':
        return `${field} IS DISTINCT FROM ${ph}`;
      case 'sqlite':
        return `${field} IS NOT ${ph}`;
      case 'mysql':
      case 'mariadb':
        return `NOT (${field} <=> ${ph})`;
      default:
        return `${field} <> ${ph}`;
    }
  }

  /**
   * A `$i*` comparison and the pattern it binds, asserted together because they are one decision:
   * Postgres has a native `ILIKE` and SQLite's `LIKE` already ignores (ASCII) case, so both take the
   * pattern as written, while the MySQL family lowers the column and so must lower the pattern too.
   */
  protected ilikeSql(field: string, pattern: string, n = 1): { sql: string; value: string } {
    const ph = this.ph(n);
    switch (this.dialect.dialectName) {
      case 'postgres':
      case 'cockroachdb':
        return { sql: `${field} ILIKE ${ph}`, value: pattern };
      case 'sqlite':
        return { sql: `${field} LIKE ${ph}`, value: pattern };
      default:
        return { sql: `LOWER(${field}) LIKE ${ph}`, value: pattern.toLowerCase() };
    }
  }

  /**
   * Suffix appended after INSERT/UPSERT statements that fetch the generated id via `RETURNING`
   * (MariaDB, SQLite). Empty for dialects that read the id off the driver's own insert-id header instead.
   */
  protected returningClause<E>(_entity: Type<E>): string {
    return '';
  }

  /**
   * The lock fragment this dialect appends, or `undefined` when it has no row locks at all. Driven
   * by `dialectName` like `neSql`/`likeOp` above, so every dialect spec inherits the same cases and
   * asserts either the SQL or the rejection.
   */
  protected lockClause(wait: QueryLockWait = 'block', of?: string): string | undefined {
    if (!this.dialect.supportsRowLocks) {
      return undefined;
    }
    const suffix = wait === 'skip' ? ' SKIP LOCKED' : wait === 'nowait' ? ' NOWAIT' : '';
    return ` FOR UPDATE${of ? ` OF ${of}` : ''}${suffix}`;
  }

  /** Whether this engine has row locks at all; the cases below split on it rather than on a name. */
  protected get hasRowLocks(): boolean {
    return this.lockClause() !== undefined;
  }

  /** Asserts the emitted lock fragment, or the rejection when the dialect has no row locks. */
  private expectLock<E>(entity: Type<E>, q: Query<E>, expected: string | undefined) {
    if (expected === undefined) {
      expect(() => this.exec((ctx) => this.dialect.find(ctx, entity, q))).toThrow(
        `${this.dialect.dialectName} does not support row-level locking`,
      );
      return;
    }
    expect(this.exec((ctx) => this.dialect.find(ctx, entity, q)).sql).toContain(expected);
  }

  shouldFindWithLock() {
    this.expectLock(User, { $select: { id: true }, $lock: true }, this.lockClause());
  }

  shouldFindWithLockSkipLocked() {
    this.expectLock(User, { $select: { id: true }, $lock: { wait: 'skip' } }, this.lockClause('skip'));
  }

  shouldFindWithLockNoWait() {
    this.expectLock(User, { $select: { id: true }, $lock: { wait: 'nowait' } }, this.lockClause('nowait'));
  }

  /** `true` and the defaulted object form are the same lock, so they must emit the same SQL. */
  shouldAcceptBooleanAndObjectAlike() {
    if (!this.hasRowLocks) {
      return;
    }
    const boolForm = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $lock: true }));
    const objForm = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $lock: {} }));
    expect(boolForm.sql).toBe(objForm.sql);
  }

  /** `false` is for queries built conditionally: it must emit nothing at all. */
  shouldEmitNoLockWhenFalse() {
    const { sql } = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $lock: false }));
    expect(sql).not.toContain('FOR UPDATE');
  }

  /** Regression: every engine wants the lock after LIMIT/OFFSET, which `pager` emits. */
  shouldPlaceLockAfterLimitAndOffset() {
    const clause = this.lockClause();
    if (!clause) {
      return;
    }
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $limit: 10, $skip: 5, $lock: true }),
    );
    expect(sql.endsWith(clause)).toBe(true);
    expect(sql.indexOf('LIMIT')).toBeLessThan(sql.indexOf('FOR UPDATE'));
  }

  /** A lock belongs to a SELECT: `search` is shared, so these must stay clean. */
  shouldNotEmitLockOnCount() {
    const q = { $where: { id: 1 }, $lock: true } as never;
    expect(this.exec((ctx) => this.dialect.count(ctx, User, q)).sql).not.toContain('FOR UPDATE');
  }

  /**
   * The statistic each engine keeps, or the refusal where it keeps none. Overridden by every family
   * that has one; the default asserts the throw, which is what SQLite inherits - and what it must
   * do, since falling back to `COUNT(*)` would run the scan `estimatedCount` exists to avoid.
   */
  shouldEstimatedCount() {
    expect(() => this.exec((ctx) => this.dialect.estimatedCount(ctx, User))).toThrow(
      `${this.dialect.dialectName} does not support estimatedCount`,
    );
  }

  shouldNotEmitLockOnUpdate() {
    const q = { $where: { id: 1 }, $lock: true } as never;
    expect(this.exec((ctx) => this.dialect.update(ctx, User, q, { name: 'x' })).sql).not.toContain('FOR UPDATE');
  }

  shouldNotEmitLockOnDelete() {
    const q = { $where: { id: 1 }, $lock: true } as never;
    expect(this.exec((ctx) => this.dialect.delete(ctx, User, q)).sql).not.toContain('FOR UPDATE');
  }

  shouldRejectUnknownLockWait() {
    expect(() =>
      this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $lock: { wait: 'soon' as never } })),
    ).toThrow('unknown $lock wait policy: soon');
  }

  /**
   * A bare lock over a join is an error on Postgres and over-locks elsewhere, so a joined query
   * narrows to the root table. MariaDB has no `OF` and rejects the combination instead.
   */
  shouldNarrowLockToRootTableWhenPopulating() {
    const e = this.dialect.escapeIdChar;
    if (!this.hasRowLocks) {
      return;
    }
    const run = () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, User, { $select: { id: true }, $populate: { company: true }, $lock: true }),
      );
    if (!this.dialect.supportsLockOf) {
      expect(run).toThrow('cannot narrow a row lock to one table');
      return;
    }
    expect(run().sql).toContain(this.lockClause('block', `${e}User${e}`));
  }

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('`');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('START TRANSACTION');
  }

  shouldGetBeginTransactionStatementsWithoutIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements()).toEqual([this.dialect.beginTransactionCommand]);
  }

  shouldInsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        {
          name: 'Some name 1',
          email: 'someemail1@example.com',
          createdAt: 123,
        },
        {
          name: 'Some name 2',
          email: 'someemail2@example.com',
          createdAt: 456,
        },
        {
          name: 'Some name 3',
          email: 'someemail3@example.com',
          createdAt: 789,
        },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)' +
        this.returningClause(User),
    );
    expect(values).toEqual([
      'Some name 1',
      'someemail1@example.com',
      123,
      'Some name 2',
      'someemail2@example.com',
      456,
      'Some name 3',
      'someemail3@example.com',
      789,
    ]);
  }

  /**
   * A mixed batch: columns are the union across records (first-seen order), an explicit id is kept,
   * and any column a record omits (the missing id in row 2, the missing email in row 1) inserts its
   * database default.
   */
  shouldInsertManyWithHeterogeneousColumns() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { id: 5, name: 'Some name 1', createdAt: 123 },
        { name: 'Some name 2', email: 'someemail2@example.com', createdAt: 456 },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO `User` (`id`, `name`, `createdAt`, `email`) VALUES (?, ?, ?, DEFAULT), (DEFAULT, ?, ?, ?)' +
        this.returningClause(User),
    );
    expect(values).toEqual([5, 'Some name 1', 123, 'Some name 2', 456, 'someemail2@example.com']);
  }

  shouldInsertOne() {
    let res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?)' + this.returningClause(User),
    );
    expect(res.values).toEqual(['Some Name', 'someemail@example.com', 123]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, InventoryAdjustment, {
        date: new Date(2021, 11, 31, 23, 59, 59, 999),
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe(
      'INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES (?, ?)' +
        this.returningClause(InventoryAdjustment),
    );
    expect(res.values[0]).toBeInstanceOf(Date);
    expect(res.values[1]).toBe(123);
  }

  shouldInsertWithOnInsertId() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    );
    expect(sql).toBe(
      'INSERT INTO `TaxCategory` (`name`, `createdAt`, `pk`) VALUES (?, ?, ?)' + this.returningClause(TaxCategory),
    );
    expect(values[0]).toBe('Some Name');
    expect(values[1]).toBe(123);
    expect(values[2]).toMatch(/.+/);
  }

  shouldUpdateWithRawString() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: raw`'value'`,
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe("UPDATE `Company` SET `kind` = 'value', `updatedAt` = ? WHERE `id` = ?");
    expect(values).toEqual([123, 1]);
  }

  shouldUpdateWithJsonbField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { private: 1 },
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe('UPDATE `Company` SET `kind` = ?, `updatedAt` = ? WHERE `id` = ?');
    expect(values).toEqual(['{"private":1}', 123, 1]);
  }

  /**
   * The nine `$set`/`$push`/`$pull`/`$unset` combinations every dialect must render, run through
   * one body per case below - only the expected `{ sql, values }` differs per dialect, since Postgres
   * binds a whole-object JSONB merge for `$set` and a `text[]` array for `$unset` while MySQL/MariaDB/
   * SQLite bind (or inline) per key.
   */
  protected abstract readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }>;

  private assertJsonUpdate(name: JsonUpdateCaseName): void {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, { kind: JSON_UPDATE_PAYLOADS[name], updatedAt: 123 }),
    );
    const expected = this.jsonUpdateCases[name];
    expect(sql).toBe(expected.sql);
    expect(values).toEqual(expected.values);
  }

  shouldUpdateWithJsonSet() {
    this.assertJsonUpdate('set');
  }

  shouldUpdateWithJsonUnsetOnly() {
    this.assertJsonUpdate('unsetOnly');
  }

  shouldUpdateWithJsonSetUnsetCombined() {
    this.assertJsonUpdate('setUnsetCombined');
  }

  shouldUpdateWithJsonPush() {
    this.assertJsonUpdate('push');
  }

  /**
   * Elements are read back through each dialect's own per-element accessor, which preserves the
   * element's JSON type - a naive `value`/`v` column would flatten booleans to 0/1 and stringify
   * objects (see the dialects' own `jsonPullKey` docs).
   */
  shouldUpdateWithJsonPull() {
    this.assertJsonUpdate('pull');
  }

  shouldUpdateWithJsonPullPushSameKey() {
    this.assertJsonUpdate('pullPushSameKey');
  }

  shouldUpdateWithJsonSetPushCombined() {
    this.assertJsonUpdate('setPushCombined');
  }

  shouldUpdateWithJsonSetPushSameKey() {
    this.assertJsonUpdate('setPushSameKey');
  }

  shouldUpdateWithJsonPushUnsetCombined() {
    this.assertJsonUpdate('pushUnsetCombined');
  }

  shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, [
        {
          name: 'Some Name A',
        },
        {
          pk: '50',
          name: 'Some Name B',
        },
        {
          name: 'Some Name C',
        },
        {
          pk: '70',
          name: 'Some Name D',
        },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO `TaxCategory` (`name`, `createdAt`, `pk`) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)' +
        this.returningClause(TaxCategory),
    );
    expect(values[0]).toBe('Some Name A');
    expect(values[2]).toMatch(/.+/);
    expect(values[3]).toBe('Some Name B');
    expect(values[5]).toBe('50');
  }

  shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { email: true },
        {
          name: 'Some Name',
          email: 'someemail@example.com',
          createdAt: 123,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `User` \(.*`name`.*`email`.*`createdAt`.*\) VALUES \(\?, \?, \?\).+ON DUPLICATE KEY UPDATE .*`name` = VALUE\(`name`\).*`createdAt` = VALUE\(`createdAt`\).*`updatedAt` = \?.*$/,
    );
    expect(values).toEqual(['Some Name', 'someemail@example.com', 123, expect.any(Number)]);
  }

  shouldUpsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { email: true }, [
        {
          name: 'Name A',
          email: 'a@example.com',
          createdAt: 100,
        },
        {
          name: 'Name B',
          email: 'b@example.com',
          createdAt: 200,
        },
      ]),
    );
    expect(sql).toMatch(/^INSERT INTO `User` .*VALUES \(\?, \?, \?\), \(\?, \?, \?\).+ON DUPLICATE KEY UPDATE/);
    expect(values).toHaveLength(7);
  }

  shouldUpdate() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        User,
        { $where: { name: 'some', creatorId: 123 } },
        {
          name: 'Some Text',
          email: 'this field should not be updated',
          updatedAt: 321,
        },
      ),
    );
    expect(sql).toBe(
      `UPDATE ${e}User${e} SET ${e}name${e} = ${this.ph(1)}, ${e}updatedAt${e} = ${this.ph(2)} WHERE ${e}name${e} = ${this.ph(3)} AND ${e}creatorId${e} = ${this.ph(4)}`,
    );
    expect(values).toEqual(['Some Text', 321, 'some', 123]);
  }

  shouldUpdateWithAlias() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Profile,
        { $where: { pk: 123 } },
        {
          picture: 'a base64 image',
          updatedAt: 321,
        },
      ),
    );
    expect(sql).toBe(
      `UPDATE ${e}user_profile${e} SET ${e}image${e} = ${this.ph(1)}, ${e}updatedAt${e} = ${this.ph(2)} WHERE ${e}pk${e} = ${this.ph(3)}`,
    );
    expect(values).toEqual(['a base64 image', 321, 123]);
  }

  shouldSoftDelete() {
    // MeasureUnit stamps `() => Date.now()`; delete becomes an UPDATE that only touches live rows.
    const { sql, values } = this.exec((ctx) => this.dialect.delete(ctx, MeasureUnit, { $where: { id: 1 } }));
    const deletedAt = this.dialect.escapeId('deletedAt');
    expect(sql).toContain(`UPDATE ${this.dialect.escapeId('MeasureUnit')} SET ${deletedAt} = `);
    expect(sql).toContain(`${deletedAt} IS NULL`);
    expect(typeof values[0]).toBe('number');
    expect(values).toContain(1);
  }

  shouldSoftDeleteWithRawValue() {
    // A raw stamp is emitted inline, not bound as a parameter.
    const { sql, values } = this.exec((ctx) => this.dialect.delete(ctx, SoftDeleteRaw, { $where: { id: 1 } }));
    expect(sql).toContain(`SET ${this.dialect.escapeId('deletedAt')} = NOW()`);
    expect(values).toEqual([1]);
  }

  shouldReadWithDeleted() {
    const deletedAtIsNull = `${this.dialect.escapeId('deletedAt')} IS NULL`;
    // default read applies the soft-delete filter
    let res = this.exec((ctx) => this.dialect.find(ctx, MeasureUnit, { $select: { id: true } }));
    expect(res.sql).toContain(deletedAtIsNull);
    // bypass by name
    res = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnit, { $select: { id: true } }, { filters: { softDelete: false } }),
    );
    expect(res.sql).not.toContain(deletedAtIsNull);
    // bypass all filters
    res = this.exec((ctx) => this.dialect.find(ctx, MeasureUnit, { $select: { id: true } }, { filters: false }));
    expect(res.sql).not.toContain(deletedAtIsNull);
  }

  shouldGenerateRestoreUpdate() {
    // Restore = UPDATE set the soft-delete field to null, with the soft-delete read filter disabled.
    const field = 'deletedAt';
    const payload = { [field]: null } as UpdatePayload<MeasureUnit>;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(ctx, MeasureUnit, { $where: { id: 1, deletedAt: { $ne: null } } }, payload, {
        filters: { softDelete: false },
      }),
    );
    const deletedAt = this.dialect.escapeId('deletedAt');
    expect(sql).toContain(`SET ${deletedAt} = ${this.ph(1)}`);
    expect(sql).not.toContain(`${deletedAt} IS NULL`); // soft-delete read filter disabled
    expect(values).toContain(1);
  }

  shouldFind() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { id: 123, name: { $ne: 'abc' } },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Profile, {
        $select: { pk: true, picture: true, companyId: true },
        $where: { pk: 123, picture: 'abc' },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}pk${e}, ${e}image${e} ${e}picture${e}, ${e}companyId${e} FROM ${e}user_profile${e} WHERE ${e}pk${e} = ${this.ph(1)} AND ${e}image${e} = ${this.ph(2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnit, {
        $select: { id: true },
        $where: { id: 123, name: 'abc' },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}MeasureUnit${e} WHERE ${e}id${e} = ${this.ph(1)} AND ${e}name${e} = ${this.ph(2)} AND ${e}deletedAt${e} IS NULL`,
    );
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldFindWithPopulateOnly() {
    const e = this.dialect.escapeIdChar;
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $populate: {
          profile: {
            $select: { picture: true },
          },
        },
        $where: { id: 123 },
      }),
    );
    expect(res.sql).toContain(
      `LEFT JOIN ${e}user_profile${e} ${e}profile${e} ON ${e}profile${e}.${e}creatorId${e} = ${e}User${e}.${e}id${e}`,
    );
    expect(res.sql).toContain(`${e}profile${e}.${e}image${e} ${e}profile.picture${e}`);
    expect(res.values).toEqual([123]);
  }

  shouldBeSecure() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, something: true } as any,
        $where: {
          id: 1,
          something: 1,
        } as any,
        $sort: {
          id: 1,
          something: 1,
        } as any,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `something` = ? ORDER BY `id`, `something`');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        something: 'anything',
        createdAt: 1,
      } as any),
    );
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `createdAt`) VALUES (?, ?)' + this.returningClause(User));
    expect(res.values).toEqual(['Some Name', 1]);

    res = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        User,
        {
          $where: { something: 'anything' } as any,
        },
        {
          name: 'Some Name',
          something: 'anything',
          updatedAt: 1,
        } as any,
      ),
    );
    expect(res.sql).toBe('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `something` = ?');
    expect(res.values).toEqual(['Some Name', 1, 'anything']);

    res = this.exec((ctx) =>
      this.dialect.delete(ctx, User, {
        $where: { something: 'anything' } as any,
      }),
    );
    expect(res.sql).toBe('DELETE FROM `User` WHERE `something` = ?');
    expect(res.values).toEqual(['anything']);
  }

  shouldFind$and() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $and: [{ id: 123, name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} AND ${e}name${e} = ${this.ph(2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: { $and: [{ id: 123 }], name: 'abc' },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} AND ${e}name${e} = ${this.ph(2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldFind$or() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $or: [{ id: 123 }, { name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} OR ${e}name${e} = ${this.ph(2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $or: [{ id: 123 }] },
      }),
    );
    expect(res.sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)}`);
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: { $or: [{ id: 123, name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} AND ${e}name${e} = ${this.ph(2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $or: [{ id: 123 }], name: 'abc' },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} AND ${e}name${e} = ${this.ph(2)}`,
    );
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldFind$not() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: 'Some' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT `name` = ?');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: { $not: 123 } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT (`id` = ?)');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: { $not: [123, 456] } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT (`id` IN (?, ?))');
    expect(res.values).toEqual([123, 456]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: 123, name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE `id` = ? AND NOT (`name` LIKE ?)');
    expect(res.values).toEqual([123, 'a%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { name: { $not: { $startsWith: 'a', $endsWith: 'z' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT ((`name` LIKE ? AND `name` LIKE ?))');
    expect(res.values).toEqual(['a%', '%z']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: { $like: 'Some', $ne: 'Something' } }] },
      }),
    );
    expect(res.sql).toBe(`SELECT \`id\` FROM \`User\` WHERE NOT (\`name\` LIKE ? AND ${this.neSql('`name`', 2)})`);
    expect(res.values).toEqual(['Some', 'Something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: 'abc' }, { creatorId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT (`name` = ? AND `creatorId` = ?)');
    expect(res.values).toEqual(['abc', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Tax, {
        $select: { id: true },
        $where: { companyId: 1, name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Tax` WHERE `companyId` = ? AND NOT (`name` LIKE ?)');
    expect(res.values).toEqual([1, 'a%']);
  }

  shouldFind$nor() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $nor: [{ name: 'Some' }] },
      }),
    );
    expect(res.sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e} WHERE NOT ${e}name${e} = ${this.ph(1)}`);
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $nor: [{ name: { $like: 'Some', $ne: 'Something' } }] },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE NOT (${e}name${e} LIKE ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)})`,
    );
    expect(res.values).toEqual(['Some', 'Something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $nor: [{ name: 'abc' }, { creatorId: 1 }] },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE NOT (${e}name${e} = ${this.ph(1)} OR ${e}creatorId${e} = ${this.ph(2)})`,
    );
    expect(res.values).toEqual(['abc', 1]);
  }

  shouldFind$orAnd$and() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { creatorId: 1, $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }], id: 1 },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ? AND (`name` IN (?, ?, ?) OR `email` = ?) AND `id` = ?',
    );
    expect(res.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1]);

    const res2 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          creatorId: 1,
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: 1,
          email: 'e',
        },
      }),
    );
    expect(res2.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ?' +
        ' AND (`name` IN (?, ?, ?) OR `email` = ?) AND `id` = ? AND `email` = ?',
    );
    expect(res2.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1, 'e']);

    const res3 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          creatorId: 1,
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: 1,
          email: 'e',
        },
        $sort: { name: 1, createdAt: -1 },
        $skip: 50,
        $limit: 10,
      }),
    );
    expect(res3.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ?' +
        ' AND (`name` IN (?, ?, ?) OR `email` = ?)' +
        ' AND `id` = ? AND `email` = ?' +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50',
    );
    expect(res3.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1, 'e']);

    const res4 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          $or: [
            {
              creatorId: 1,
              id: 1,
              email: 'e',
            },
            { name: ['a', 'b', 'c'], email: 'abc@example.com' },
          ],
        },
        $sort: { name: 'asc', createdAt: 'desc' },
        $skip: 50,
        $limit: 10,
      }),
    );
    expect(res4.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`creatorId` = ? AND `id` = ? AND `email` = ?)' +
        ' OR (`name` IN (?, ?, ?) AND `email` = ?)' +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50',
    );
    expect(res4.values).toEqual([1, 1, 'e', 'a', 'b', 'c', 'abc@example.com']);
  }

  shouldFindSingle$where() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some' },
        $limit: 3,
      }),
    );
    expect(sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)} LIMIT 3`);
    expect(values).toEqual(['some']);
  }

  /**
   * A bare `Date` is a value to compare against, not a map of operators to iterate. Reading its
   * (nonexistent) own keys as operators emitted `WHERE ` and dropped the condition entirely.
   */
  shouldFind$whereByBareDate() {
    const e = this.dialect.escapeIdChar;
    const date = new Date('2020-01-01T00:00:00.000Z');
    const byDate = this.exec((ctx) =>
      this.dialect.find(ctx, InventoryAdjustment, { $select: { id: true }, $where: { date } }),
    );
    expect(byDate.sql).toBe(`SELECT ${e}id${e} FROM ${e}InventoryAdjustment${e} WHERE ${e}date${e} = ${this.ph(1)}`);
    // the bound representation is the dialect's own (SQLite stores epoch millis); that it bound at
    // all is the point, since the condition used to vanish.
    expect(byDate.values).toHaveLength(1);

    // and the same value under an explicit `$eq` renders identically
    const byEq = this.exec((ctx) =>
      this.dialect.find(ctx, InventoryAdjustment, { $select: { id: true }, $where: { date: { $eq: date } } }),
    );
    expect(byEq.sql).toBe(byDate.sql);
  }

  shouldFindMultipleComparisonOperators() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $or: [{ name: { $eq: 'other', $ne: 'other unwanted' } }, { companyId: 1 }] },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}name${e} = ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)}) OR ${e}companyId${e} = ${this.ph(3)}`,
    );
    expect(res.values).toEqual(['other', 'other unwanted', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { createdAt: { $gte: 123, $lte: 999 } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}createdAt${e} >= ${this.ph(1)} AND ${e}createdAt${e} <= ${this.ph(2)}) LIMIT 10`,
    );
    expect(res.values).toEqual([123, 999]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { createdAt: { $gt: 123, $lt: 999 } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}createdAt${e} > ${this.ph(1)} AND ${e}createdAt${e} < ${this.ph(2)}) LIMIT 10`,
    );
    expect(res.values).toEqual([123, 999]);
  }

  /**
   * A dotted key is only a JSON path when its root is a JSON column. Rooted anywhere else it is a
   * typo (or an injection attempt from dynamic query data) and must fail loudly instead of being
   * emitted as an identifier that silently matches nothing.
   */
  shouldRejectDottedPathOnNonJsonField() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, User, {
          $select: { id: true },
          $where: { 'name.first': 'some' } as never,
        }),
      ),
    ).toThrow('path name.first does not exist in User');
  }

  shouldRejectDottedPathOnUnknownRoot() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, User, {
          $select: { id: true },
          $where: { 'nope.first': 'some' } as never,
        }),
      ),
    ).toThrow('path nope.first does not exist in User');
  }

  /**
   * `$elemMatch` matches either the elements themselves (operators) or their properties (field
   * names). One expression cannot be both shapes at once, so a mixed object is rejected rather
   * than having half of it silently dropped.
   */
  shouldRejectElemMatchMixingOperatorsAndFieldNames() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Company, {
          $select: { id: true },
          $where: { kind: { $elemMatch: { $eq: 5, name: 'some' } } } as never,
        }),
      ),
    ).toThrow('$elemMatch cannot mix operators with field names: $eq, name');
  }

  shouldFind$ne() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some', companyId: { $ne: 5 } },
        $limit: 20,
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)} AND ${this.neSql(`${e}companyId${e}`, 2)} LIMIT 20`,
    );
    expect(values).toEqual(['some', 5]);
  }

  shouldFindIsNull() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { creatorId: 123, companyId: null as any },
        $limit: 5,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}creatorId${e} = ${this.ph(1)} AND ${e}companyId${e} IS NULL LIMIT 5`,
    );
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { creatorId: 123, companyId: { $ne: null } },
        $limit: 5,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}creatorId${e} = ${this.ph(1)} AND ${e}companyId${e} IS NOT NULL LIMIT 5`,
    );
    expect(res.values).toEqual([123]);
  }

  shouldFind$in() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some', companyId: [1, 2, 3] },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` IN (?, ?, ?) LIMIT 10');
    expect(res.values).toEqual(['some', 1, 2, 3]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some', companyId: { $in: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` IN (?, ?, ?) LIMIT 10');
    expect(res.values).toEqual(['some', 1, 2, 3]);
  }

  /**
   * A non-array `$in` used to coerce to `[]` and match nothing, which reads as a legitimately empty
   * result. The types forbid it, but `/http` casts client JSON straight to `Query`, so it arrives untyped.
   */
  shouldRejectNonArray$in() {
    for (const operand of [undefined, null, 'abc', 5, {}]) {
      expect(() =>
        this.exec((ctx) =>
          this.dialect.find(ctx, User, {
            $select: { id: true },
            $where: { companyId: { $in: operand } } as never,
          }),
        ),
      ).toThrow(/\$in expects an array/);
    }

    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, User, {
          $select: { id: true },
          $where: { companyId: { $nin: 'abc' } } as never,
        }),
      ),
    ).toThrow(/\$nin expects an array/);
  }

  shouldFind$nin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some', companyId: { $nin: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` NOT IN (?, ?, ?) LIMIT 10');
    expect(values).toEqual(['some', 1, 2, 3]);
  }

  shouldFind$selectFields() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $populate: { company: true } }),
    );
    expect(sql).toBe(
      `SELECT ${e}User${e}.${e}id${e}, ${e}company${e}.${e}id${e} ${e}company.id${e}, ${e}company${e}.${e}companyId${e} ${e}company.companyId${e}, ${e}company${e}.${e}creatorId${e} ${e}company.creatorId${e}, ${e}company${e}.${e}createdAt${e} ${e}company.createdAt${e}, ${e}company${e}.${e}updatedAt${e} ${e}company.updatedAt${e}, ${e}company${e}.${e}name${e} ${e}company.name${e}, ${e}company${e}.${e}description${e} ${e}company.description${e}, ${e}company${e}.${e}kind${e} ${e}company.kind${e} FROM ${e}User${e} LEFT JOIN ${e}Company${e} ${e}company${e} ON ${e}company${e}.${e}id${e} = ${e}User${e}.${e}companyId${e}`,
    );
  }

  shouldFind$selectOneToOne() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, name: true },
        $populate: { profile: { $select: { id: true, picture: true } } },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}User${e}.${e}id${e}, ${e}User${e}.${e}name${e}, ${e}profile${e}.${e}pk${e} ${e}profile.pk${e}, ${e}profile${e}.${e}image${e} ${e}profile.picture${e} FROM ${e}User${e} LEFT JOIN ${e}user_profile${e} ${e}profile${e} ON ${e}profile${e}.${e}creatorId${e} = ${e}User${e}.${e}id${e}`,
    );

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $populate: { profile: true } }));
    expect(res.sql).toBe(
      `SELECT ${e}User${e}.${e}id${e}, ${e}User${e}.${e}companyId${e}, ${e}User${e}.${e}creatorId${e}, ${e}User${e}.${e}createdAt${e}, ${e}User${e}.${e}updatedAt${e}, ${e}User${e}.${e}name${e}, ${e}User${e}.${e}email${e}, ${e}profile${e}.${e}companyId${e} ${e}profile.companyId${e}, ${e}profile${e}.${e}creatorId${e} ${e}profile.creatorId${e}, ${e}profile${e}.${e}createdAt${e} ${e}profile.createdAt${e}, ${e}profile${e}.${e}updatedAt${e} ${e}profile.updatedAt${e}, ${e}profile${e}.${e}pk${e} ${e}profile.pk${e}, ${e}profile${e}.${e}image${e} ${e}profile.picture${e} FROM ${e}User${e} LEFT JOIN ${e}user_profile${e} ${e}profile${e} ON ${e}profile${e}.${e}creatorId${e} = ${e}User${e}.${e}id${e}`,
    );
  }

  /**
   * A to-many is filled by a second query keyed on the parent's id, so subtracting it is refused -
   * by `$exclude` and by a falsy `$select` alike. The relation itself adds no join of its own.
   */
  shouldFind$excludeKeepsTheParentIdAToManyFillNeeds() {
    const e = this.dialect.escapeIdChar;
    const expected = `SELECT ${e}User${e}.${e}id${e}, ${e}User${e}.${e}companyId${e}, ${e}User${e}.${e}creatorId${e}, ${e}User${e}.${e}createdAt${e}, ${e}User${e}.${e}updatedAt${e}, ${e}User${e}.${e}name${e}, ${e}User${e}.${e}email${e} FROM ${e}User${e}`;

    expect(
      this.exec((ctx) => this.dialect.find(ctx, User, { $exclude: { id: true }, $populate: { users: true } })).sql,
    ).toBe(expected);
    expect(
      this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: false }, $populate: { users: true } })).sql,
    ).toBe(expected);
  }

  shouldFind$excludeOnAJoinedRelation() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $populate: { profile: { $exclude: { picture: true } } },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}User${e}.${e}id${e}, ${e}profile${e}.${e}companyId${e} ${e}profile.companyId${e}, ${e}profile${e}.${e}creatorId${e} ${e}profile.creatorId${e}, ${e}profile${e}.${e}createdAt${e} ${e}profile.createdAt${e}, ${e}profile${e}.${e}updatedAt${e} ${e}profile.updatedAt${e}, ${e}profile${e}.${e}pk${e} ${e}profile.pk${e} FROM ${e}User${e} LEFT JOIN ${e}user_profile${e} ${e}profile${e} ON ${e}profile${e}.${e}creatorId${e} = ${e}User${e}.${e}id${e}`,
    );
  }

  /** Same rule one level down: the joined row is keyed by `profile.pk`, so subtracting it is refused. */
  shouldFind$excludeKeepsTheIdOfAJoinedRelation() {
    const e = this.dialect.escapeIdChar;
    const expected = `SELECT ${e}User${e}.${e}id${e}, ${e}profile${e}.${e}pk${e} ${e}profile.pk${e}, ${e}profile${e}.${e}companyId${e} ${e}profile.companyId${e}, ${e}profile${e}.${e}creatorId${e} ${e}profile.creatorId${e}, ${e}profile${e}.${e}createdAt${e} ${e}profile.createdAt${e}, ${e}profile${e}.${e}updatedAt${e} ${e}profile.updatedAt${e}, ${e}profile${e}.${e}image${e} ${e}profile.picture${e} FROM ${e}User${e} LEFT JOIN ${e}user_profile${e} ${e}profile${e} ON ${e}profile${e}.${e}creatorId${e} = ${e}User${e}.${e}id${e}`;

    expect(
      this.exec((ctx) =>
        this.dialect.find(ctx, User, {
          $select: { id: true },
          $populate: { profile: { $exclude: { pk: true } } },
        }),
      ).sql,
    ).toBe(expected);
    expect(
      this.exec((ctx) =>
        this.dialect.find(ctx, User, {
          $select: { id: true },
          $populate: { profile: { $select: { pk: false } } },
        }),
      ).sql,
    ).toBe(expected);
  }

  shouldFind$selectManyToOne() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
          code: true,
        },
        $populate: {
          tax: { $select: { id: true, name: true }, $required: true },
          measureUnit: { $select: { id: true, name: true, categoryId: true } },
        },
        $limit: 100,
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e}, ${e}Item${e}.${e}name${e}, ${e}Item${e}.${e}code${e}, ${e}tax${e}.${e}id${e} ${e}tax.id${e}, ${e}tax${e}.${e}name${e} ${e}tax.name${e}, ${e}measureUnit${e}.${e}id${e} ${e}measureUnit.id${e}, ${e}measureUnit${e}.${e}name${e} ${e}measureUnit.name${e}, ${e}measureUnit${e}.${e}categoryId${e} ${e}measureUnit.categoryId${e} FROM ${e}Item${e} INNER JOIN ${e}Tax${e} ${e}tax${e} ON ${e}tax${e}.${e}id${e} = ${e}Item${e}.${e}taxId${e} LEFT JOIN ${e}MeasureUnit${e} ${e}measureUnit${e} ON ${e}measureUnit${e}.${e}id${e} = ${e}Item${e}.${e}measureUnitId${e} AND ${e}measureUnit${e}.${e}deletedAt${e} IS NULL LIMIT 100`,
    );
  }

  /**
   * Regression for the JOIN/populate gap: a `security: true` filter on a joined (m1) relation
   * must apply even to a bare `$populate: { related: true }` with no explicit `$where` on it.
   */
  shouldApplySecurityFilterToJoinedPopulateWithoutExplicitWhere() {
    const e = this.dialect.escapeIdChar;
    const { sql } = withContext({ secureTenantId: 5 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureParent, {
          $select: { id: true },
          $populate: { related: { $select: { id: true, name: true } } },
        }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}SecureParent${e}.${e}id${e}, ${e}related${e}.${e}id${e} ${e}related.id${e}, ${e}related${e}.${e}name${e} ${e}related.name${e} FROM ${e}SecureParent${e} LEFT JOIN ${e}SecureRelated${e} ${e}related${e} ON ${e}related${e}.${e}id${e} = ${e}SecureParent${e}.${e}relatedId${e} AND ${e}related${e}.${e}tenantId${e} = ${this.ph(1)}`,
    );
  }

  /** Same shape as above, but with no ambient context: the security filter must fail closed. */
  shouldFailClosedForJoinedPopulateWhenSecurityContextIsMissing() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureParent, {
          $select: { id: true },
          $populate: { related: { $select: { id: true, name: true } } },
        }),
      ),
    ).toThrow(UqlSecurityError);
  }

  /** A `$size` count is a client-supplied threshold over rows it never sees: the target's filters must scope it. */
  shouldApplyTargetFiltersToOneToManySizeCount() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = withContext({ secureTenantId: 7 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureCollection, {
          $select: { id: true },
          $where: { children: { $size: { $gte: 2 } } },
        }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE (SELECT COUNT(*) FROM ${e}SecureChild${e} WHERE ${e}SecureChild${e}.${e}collectionId${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureChild${e}.${e}deletedAt${e} IS NULL AND ${e}SecureChild${e}.${e}tenantId${e} = ${this.ph(1)}) >= ${this.ph(2)}`,
    );
    expect(values).toEqual([7, 2]);
  }

  /** A single-valued relation counts on the parent's FK, not its PK - the join side the `EXISTS` form uses. */
  shouldJoinManyToOneSizeCountOnTheParentForeignKey() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = withContext({ secureTenantId: 7 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureParent, { $select: { id: true }, $where: { related: { $size: 1 } } }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureParent${e} WHERE (SELECT COUNT(*) FROM ${e}SecureRelated${e} WHERE ${e}SecureRelated${e}.${e}id${e} = ${e}SecureParent${e}.${e}relatedId${e} AND ${e}SecureRelated${e}.${e}tenantId${e} = ${this.ph(1)}) = ${this.ph(2)}`,
    );
    expect(values).toEqual([7, 1]);
  }

  /** The junction cannot be scoped by a target filter, so the counted rows narrow to the ids satisfying it. */
  shouldApplyTargetFiltersToManyToManySizeCount() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = withContext({ secureTenantId: 7 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureCollection, {
          $select: { id: true },
          $where: { taggedChildren: { $size: { $gte: 2 } } },
        }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE (SELECT COUNT(*) FROM ${e}SecureCollectionChild${e} WHERE ${e}SecureCollectionChild${e}.${e}secureCollectionId${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureCollectionChild${e}.${e}secureChildId${e} IN (SELECT ${e}SecureChild${e}.${e}id${e} FROM ${e}SecureChild${e} WHERE ${e}SecureChild${e}.${e}deletedAt${e} IS NULL AND ${e}SecureChild${e}.${e}tenantId${e} = ${this.ph(1)})) >= ${this.ph(2)}`,
    );
    expect(values).toEqual([7, 2]);
  }

  /** A renamed PK/FK correlates on the column, not the field key. One query pins both projections. */
  shouldCorrelateRelationSubqueryOnMappedColumnNames() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, RenamedParent, {
        $select: { id: true },
        $where: { children: { id: 3 }, $and: [{ children: { $size: 1 } }] },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}parent_pk${e} ${e}id${e} FROM ${e}RenamedParent${e} WHERE EXISTS (SELECT 1 FROM ${e}RenamedChild${e} WHERE ${e}RenamedChild${e}.${e}parent_fk${e} = ${e}RenamedParent${e}.${e}parent_pk${e} AND ${e}RenamedChild${e}.${e}id${e} = ${this.ph(1)}) AND (SELECT COUNT(*) FROM ${e}RenamedChild${e} WHERE ${e}RenamedChild${e}.${e}parent_fk${e} = ${e}RenamedParent${e}.${e}parent_pk${e}) = ${this.ph(2)}`,
    );
    expect(values).toEqual([3, 1]);
  }

  /** The junction's own FK columns are resolved the same way. */
  shouldCorrelateManyToManySubqueryOnMappedJunctionColumnNames() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = withContext({ secureTenantId: 7 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { renamedChildren: { id: 5 } } }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE EXISTS (SELECT 1 FROM ${e}SecureCollectionRenamed${e} WHERE ${e}SecureCollectionRenamed${e}.${e}renamed_collection${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureCollectionRenamed${e}.${e}renamed_child${e} IN (SELECT ${e}SecureChild${e}.${e}id${e} FROM ${e}SecureChild${e} WHERE ${e}SecureChild${e}.${e}id${e} = ${this.ph(1)} AND ${e}SecureChild${e}.${e}deletedAt${e} IS NULL AND ${e}SecureChild${e}.${e}tenantId${e} = ${this.ph(2)}))`,
    );
    expect(values).toEqual([5, 7]);
  }

  /** The junction is a row being read too, so its own filters scope the count. */
  shouldApplyJunctionFiltersToManyToManySizeCount() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { linkedChildren: { $size: 2 } } }),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE (SELECT COUNT(*) FROM ${e}SecureCollectionLink${e} WHERE ${e}SecureCollectionLink${e}.${e}secureCollectionId${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureCollectionLink${e}.${e}deletedAt${e} IS NULL) = ${this.ph(1)}`,
    );
    expect(values).toEqual([2]);
  }

  /** Both levels scope the `EXISTS` form: the junction's own filters and the target's. */
  shouldApplyJunctionAndTargetFiltersToManyToManyRelationFilter() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { linkedChildren: { id: 5 } } }),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE EXISTS (SELECT 1 FROM ${e}SecureCollectionLink${e} WHERE ${e}SecureCollectionLink${e}.${e}secureCollectionId${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureCollectionLink${e}.${e}deletedAt${e} IS NULL AND ${e}SecureCollectionLink${e}.${e}plainChildId${e} IN (SELECT ${e}PlainChild${e}.${e}id${e} FROM ${e}PlainChild${e} WHERE ${e}PlainChild${e}.${e}id${e} = ${this.ph(1)}))`,
    );
    expect(values).toEqual([5]);
  }

  /** An unfiltered target contributes nothing, so the mm count stays junction-only. */
  shouldKeepManyToManySizeCountJunctionOnlyForUnfilteredTarget() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { plainChildren: { $size: 3 } } }),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE (SELECT COUNT(*) FROM ${e}SecureCollectionPlain${e} WHERE ${e}SecureCollectionPlain${e}.${e}secureCollectionId${e} = ${e}SecureCollection${e}.${e}id${e}) = ${this.ph(1)}`,
    );
    expect(values).toEqual([3]);
  }

  /** A `$size` count over a secured target with no ambient context must fail closed. */
  shouldFailClosedForSizeCountWhenSecurityContextIsMissing() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { children: { $size: 1 } } }),
      ),
    ).toThrow(UqlSecurityError);
  }

  /**
   * The `EXISTS` counterpart: a relation filter must not match a parent through a trashed or
   * out-of-scope child, the same rows a joined `$populate` on that relation would see.
   */
  shouldApplyTargetFiltersToOneToManyRelationFilter() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = withContext({ secureTenantId: 7 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { children: { id: 3 } } }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE EXISTS (SELECT 1 FROM ${e}SecureChild${e} WHERE ${e}SecureChild${e}.${e}collectionId${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureChild${e}.${e}id${e} = ${this.ph(1)} AND ${e}SecureChild${e}.${e}deletedAt${e} IS NULL AND ${e}SecureChild${e}.${e}tenantId${e} = ${this.ph(2)})`,
    );
    expect(values).toEqual([3, 7]);
  }

  /** Same for mm, where the target is reached through the junction's `IN` sub-select. */
  shouldApplyTargetFiltersToManyToManyRelationFilter() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = withContext({ secureTenantId: 7 }, () =>
      this.exec((ctx) =>
        this.dialect.find(ctx, SecureCollection, { $select: { id: true }, $where: { taggedChildren: { id: 3 } } }),
      ),
    );
    expect(sql).toBe(
      `SELECT ${e}id${e} FROM ${e}SecureCollection${e} WHERE EXISTS (SELECT 1 FROM ${e}SecureCollectionChild${e} WHERE ${e}SecureCollectionChild${e}.${e}secureCollectionId${e} = ${e}SecureCollection${e}.${e}id${e} AND ${e}SecureCollectionChild${e}.${e}secureChildId${e} IN (SELECT ${e}SecureChild${e}.${e}id${e} FROM ${e}SecureChild${e} WHERE ${e}SecureChild${e}.${e}id${e} = ${this.ph(1)} AND ${e}SecureChild${e}.${e}deletedAt${e} IS NULL AND ${e}SecureChild${e}.${e}tenantId${e} = ${this.ph(2)}))`,
    );
    expect(values).toEqual([3, 7]);
  }

  shouldFind$selectWithAllFieldsAndSpecificFieldsAndWhere() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
        },
        $populate: {
          measureUnit: { $select: { id: true, name: true }, $where: { name: { $ne: 'unidad' } }, $required: true },
          tax: { $select: { id: true, name: true } },
        },
        $where: { salePrice: { $gte: 1000 }, name: { $startsWith: 'A' } },
        $sort: { tax: { name: 1 }, measureUnit: { name: 1 }, createdAt: -1 },
        $limit: 100,
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e}, ${e}Item${e}.${e}name${e}` +
        `, ${e}measureUnit${e}.${e}id${e} ${e}measureUnit.id${e}, ${e}measureUnit${e}.${e}name${e} ${e}measureUnit.name${e}` +
        `, ${e}tax${e}.${e}id${e} ${e}tax.id${e}, ${e}tax${e}.${e}name${e} ${e}tax.name${e}` +
        ` FROM ${e}Item${e}` +
        ` INNER JOIN ${e}MeasureUnit${e} ${e}measureUnit${e} ON ${e}measureUnit${e}.${e}id${e} = ${e}Item${e}.${e}measureUnitId${e} AND ${this.neSql(`${e}measureUnit${e}.${e}name${e}`)} AND ${e}measureUnit${e}.${e}deletedAt${e} IS NULL` +
        ` LEFT JOIN ${e}Tax${e} ${e}tax${e} ON ${e}tax${e}.${e}id${e} = ${e}Item${e}.${e}taxId${e}` +
        ` WHERE ${e}Item${e}.${e}salePrice${e} >= ${this.ph(2)} AND ${e}Item${e}.${e}name${e} LIKE ${this.ph(3)}` +
        ` ORDER BY ${e}tax${e}.${e}name${e}, ${e}measureUnit${e}.${e}name${e}, ${e}Item${e}.${e}createdAt${e} DESC LIMIT 100`,
    );
    expect(values).toEqual(['unidad', 1000, 'A%']);
  }

  /** A `$sort` reaching into a relation joins it, exactly as populating it would - filters included. */
  shouldSortByRelationWithoutPopulate() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, { $select: { id: true }, $sort: { measureUnit: { name: 1 } } }),
    );
    expect(sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e} FROM ${e}Item${e}` +
        ` LEFT JOIN ${e}MeasureUnit${e} ${e}measureUnit${e} ON ${e}measureUnit${e}.${e}id${e} = ${e}Item${e}.${e}measureUnitId${e} AND ${e}measureUnit${e}.${e}deletedAt${e} IS NULL` +
        ` ORDER BY ${e}measureUnit${e}.${e}name${e}`,
    );
  }

  /** A nested path is one alias (`"tax.category"`), and every level it crosses has to be joined. */
  shouldSortByNestedRelation() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, { $select: { id: true }, $sort: { tax: { category: { name: -1 } } } }),
    );
    expect(sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e} FROM ${e}Item${e}` +
        ` LEFT JOIN ${e}Tax${e} ${e}tax${e} ON ${e}tax${e}.${e}id${e} = ${e}Item${e}.${e}taxId${e}` +
        ` LEFT JOIN ${e}TaxCategory${e} ${e}tax.category${e} ON ${e}tax.category${e}.${e}pk${e} = ${e}tax${e}.${e}categoryId${e}` +
        ` ORDER BY ${e}tax.category${e}.${e}name${e} DESC`,
    );
  }

  /** A related column resolves through its own entity, so `@Field({ name })` is honoured. */
  shouldSortByRenamedRelationColumn() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $sort: { profile: { picture: 1 } } }),
    );
    expect(sql).toContain(` ORDER BY ${e}profile${e}.${e}image${e}`);
  }

  /** One join, whether `$populate` or `$sort` asked for it first - and it keeps its columns. */
  shouldReuseThePopulatedJoinWhenSorting() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $populate: { tax: { $select: { name: true }, $required: true } },
        $sort: { tax: { name: 1 } },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e}, ${e}tax${e}.${e}id${e} ${e}tax.id${e}, ${e}tax${e}.${e}name${e} ${e}tax.name${e}` +
        ` FROM ${e}Item${e}` +
        ` INNER JOIN ${e}Tax${e} ${e}tax${e} ON ${e}tax${e}.${e}id${e} = ${e}Item${e}.${e}taxId${e}` +
        ` ORDER BY ${e}tax${e}.${e}name${e}`,
    );
  }

  /**
   * The keys only a to-many's own query can carry. They reach a real `find`, so this covers the
   * rejection surfacing through the query path rather than only from the parser.
   */
  shouldRejectPagingAJoinedRelation() {
    const e = this.dialect.escapeIdChar;
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, { $select: { id: true }, $populate: { tax: { $limit: 5 } } as never }),
      ),
    ).toThrow("'$limit' is not supported inside $populate of the to-one relation 'tax'");

    // Nested joins are read the same way, so the level it sits at makes no difference.
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, {
          $select: { id: true },
          $populate: { tax: { $populate: { category: { $sort: { name: 1 } } } } } as never,
        }),
      ),
    ).toThrow("'$sort' is not supported inside $populate of the to-one relation 'category'");

    // The same keys order and page a to-many's second query, so they stay valid there. That query is
    // issued by the querier, so the parent statement is simply the unjoined one.
    expect(
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, {
          $select: { id: true },
          $populate: { tags: { $select: { name: true }, $sort: { name: 1 }, $limit: 5, $skip: 1 } },
        }),
      ).sql,
    ).toBe(`SELECT ${e}Item${e}.${e}id${e} FROM ${e}Item${e}`);
  }

  /** Every statement that cannot join says so, rather than emitting an alias nothing defines. */
  shouldRejectAnUnorderableRelationSort() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, { $select: { id: true }, $sort: { tags: { name: 1 } } as never }),
      ),
    ).toThrow("cannot $sort by 'tags'");

    expect(() =>
      this.exec((ctx) => this.dialect.update(ctx, Item, { $sort: { tax: { name: 1 } } }, { name: 'x' })),
    ).toThrow("cannot $sort by relation 'tax': this statement joins no relations");

    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, { $select: { id: true }, $distinct: true, $sort: { tax: { name: 1 } } }),
      ),
    ).toThrow("cannot $sort by relation 'tax' with $distinct");

    expect(
      () =>
        this.exec((ctx) =>
          this.dialect.aggregate(ctx, Item, { $group: { taxId: true }, $sort: { tax: { name: 1 } } as never }),
        ),
      // a relation is not a column the aggregate emits, so the general rule already covers it
    ).toThrow("cannot $sort by 'tax': it is neither a $group column nor an $agg alias");
  }

  shouldVirtualField() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: 1,
        },
        $where: {
          tagsCount: { $gte: 10 },
        },
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}Item${e} WHERE (SELECT COUNT(*) ${e}_uql_count${e} FROM ${e}ItemTag${e} WHERE ${e}ItemTag${e}.${e}itemId${e} = ${e}id${e}) >= ${this.ph(1)}`,
    );
    expect(res.values).toEqual([10]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: 1,
          name: 1,
          code: 1,
          tagsCount: 1,
        },
        $populate: {
          measureUnit: {
            $select: { id: 1, name: 1, categoryId: 1 },
            $populate: { category: { $select: { name: 1 } } },
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e}, ${e}Item${e}.${e}name${e}, ${e}Item${e}.${e}code${e}, (SELECT COUNT(*) ${e}_uql_count${e} FROM ${e}ItemTag${e} WHERE ${e}ItemTag${e}.${e}itemId${e} = ${e}Item${e}.${e}id${e}) ${e}tagsCount${e}, ${e}measureUnit${e}.${e}id${e} ${e}measureUnit.id${e}, ${e}measureUnit${e}.${e}name${e} ${e}measureUnit.name${e}, ${e}measureUnit${e}.${e}categoryId${e} ${e}measureUnit.categoryId${e}, ${e}measureUnit.category${e}.${e}id${e} ${e}measureUnit.category.id${e}, ${e}measureUnit.category${e}.${e}name${e} ${e}measureUnit.category.name${e} FROM ${e}Item${e} LEFT JOIN ${e}MeasureUnit${e} ${e}measureUnit${e} ON ${e}measureUnit${e}.${e}id${e} = ${e}Item${e}.${e}measureUnitId${e} AND ${e}measureUnit${e}.${e}deletedAt${e} IS NULL LEFT JOIN ${e}MeasureUnitCategory${e} ${e}measureUnit.category${e} ON ${e}measureUnit.category${e}.${e}id${e} = ${e}measureUnit${e}.${e}categoryId${e} AND ${e}measureUnit.category${e}.${e}deletedAt${e} IS NULL LIMIT 100`,
    );
  }

  shouldFind$selectDeep() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: 1,
          name: 1,
          code: 1,
        },
        $populate: {
          measureUnit: {
            $select: { id: 1, name: 1, categoryId: 1 },
            $populate: { category: { $select: { name: 1 } } },
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e}, ${e}Item${e}.${e}name${e}, ${e}Item${e}.${e}code${e}, ${e}measureUnit${e}.${e}id${e} ${e}measureUnit.id${e}, ${e}measureUnit${e}.${e}name${e} ${e}measureUnit.name${e}, ${e}measureUnit${e}.${e}categoryId${e} ${e}measureUnit.categoryId${e}, ${e}measureUnit.category${e}.${e}id${e} ${e}measureUnit.category.id${e}, ${e}measureUnit.category${e}.${e}name${e} ${e}measureUnit.category.name${e} FROM ${e}Item${e} LEFT JOIN ${e}MeasureUnit${e} ${e}measureUnit${e} ON ${e}measureUnit${e}.${e}id${e} = ${e}Item${e}.${e}measureUnitId${e} AND ${e}measureUnit${e}.${e}deletedAt${e} IS NULL LEFT JOIN ${e}MeasureUnitCategory${e} ${e}measureUnit.category${e} ON ${e}measureUnit.category${e}.${e}id${e} = ${e}measureUnit${e}.${e}categoryId${e} AND ${e}measureUnit.category${e}.${e}deletedAt${e} IS NULL LIMIT 100`,
    );

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
          code: true,
        },
        $populate: {
          measureUnit: {
            $select: { id: true, name: true },
            $populate: { category: { $select: { id: true, name: true } } },
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}Item${e}.${e}id${e}, ${e}Item${e}.${e}name${e}, ${e}Item${e}.${e}code${e}, ${e}measureUnit${e}.${e}id${e} ${e}measureUnit.id${e}, ${e}measureUnit${e}.${e}name${e} ${e}measureUnit.name${e}, ${e}measureUnit.category${e}.${e}id${e} ${e}measureUnit.category.id${e}, ${e}measureUnit.category${e}.${e}name${e} ${e}measureUnit.category.name${e} FROM ${e}Item${e} LEFT JOIN ${e}MeasureUnit${e} ${e}measureUnit${e} ON ${e}measureUnit${e}.${e}id${e} = ${e}Item${e}.${e}measureUnitId${e} AND ${e}measureUnit${e}.${e}deletedAt${e} IS NULL LEFT JOIN ${e}MeasureUnitCategory${e} ${e}measureUnit.category${e} ON ${e}measureUnit.category${e}.${e}id${e} = ${e}measureUnit${e}.${e}categoryId${e} AND ${e}measureUnit.category${e}.${e}deletedAt${e} IS NULL LIMIT 100`,
    );

    res = this.exec((ctx) =>
      this.dialect.find(ctx, ItemAdjustment, {
        $select: {
          id: true,
          buyPrice: true,
          number: true,
        },
        $populate: {
          item: {
            $select: {
              id: true,
              name: true,
            },
            $populate: {
              measureUnit: {
                $select: { id: true, name: true },
                $populate: { category: { $select: { id: true, name: true } } },
              },
            },
            $required: true,
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}ItemAdjustment${e}.${e}id${e}, ${e}ItemAdjustment${e}.${e}buyPrice${e}, ${e}ItemAdjustment${e}.${e}number${e}, ${e}item${e}.${e}id${e} ${e}item.id${e}, ${e}item${e}.${e}name${e} ${e}item.name${e}, ${e}item.measureUnit${e}.${e}id${e} ${e}item.measureUnit.id${e}, ${e}item.measureUnit${e}.${e}name${e} ${e}item.measureUnit.name${e}, ${e}item.measureUnit.category${e}.${e}id${e} ${e}item.measureUnit.category.id${e}, ${e}item.measureUnit.category${e}.${e}name${e} ${e}item.measureUnit.category.name${e} FROM ${e}ItemAdjustment${e} INNER JOIN ${e}Item${e} ${e}item${e} ON ${e}item${e}.${e}id${e} = ${e}ItemAdjustment${e}.${e}itemId${e} LEFT JOIN ${e}MeasureUnit${e} ${e}item.measureUnit${e} ON ${e}item.measureUnit${e}.${e}id${e} = ${e}item${e}.${e}measureUnitId${e} AND ${e}item.measureUnit${e}.${e}deletedAt${e} IS NULL LEFT JOIN ${e}MeasureUnitCategory${e} ${e}item.measureUnit.category${e} ON ${e}item.measureUnit.category${e}.${e}id${e} = ${e}item.measureUnit${e}.${e}categoryId${e} AND ${e}item.measureUnit.category${e}.${e}deletedAt${e} IS NULL LIMIT 100`,
    );
  }

  shouldFind$limit() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: 9,
        $limit: 1,
      }),
    );
    expect(res.sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} LIMIT 1`);
    expect(res.values).toEqual([9]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1, name: 1, creatorId: 1 },
        $where: 9,
        $limit: 1,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e}, ${e}name${e}, ${e}creatorId${e} FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)} LIMIT 1`,
    );
    expect(res.values).toEqual([9]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'something', creatorId: 123 },
        $limit: 1,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)} AND ${e}creatorId${e} = ${this.ph(2)} LIMIT 1`,
    );
    expect(res.values).toEqual(['something', 123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, name: true, creatorId: true },
        $limit: 25,
      }),
    );
    expect(res.sql).toBe(`SELECT ${e}id${e}, ${e}name${e}, ${e}creatorId${e} FROM ${e}User${e} LIMIT 25`);
  }

  /** Zero rows is a page like any other; read as "unset" it returned the whole table instead. */
  shouldFind$limitZero() {
    const e = this.dialect.escapeIdChar;
    const res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $limit: 0 }));
    expect(res.sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e} LIMIT 0`);
  }

  /** A page arrives from arithmetic and from REST query strings, so it is checked before it is emitted. */
  shouldRejectAnUnusablePage() {
    for (const $limit of [-1, 1.5, Number.NaN]) {
      expect(() => this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $limit }))).toThrow(
        `$limit must be a non-negative integer, got ${$limit}`,
      );
    }
    expect(() => this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $skip: -2 }))).toThrow(
      '$skip must be a non-negative integer, got -2',
    );
  }

  /**
   * The `OFFSET` clause a bare `$skip` produces. The MySQL family has no standalone `OFFSET` - it is
   * only legal after a `LIMIT` - so those dialects precede it with their "all remaining rows" count.
   */
  protected expected$skipClause(): string {
    return 'OFFSET 30';
  }

  shouldFind$skip() {
    const e = this.dialect.escapeIdChar;
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1, name: 1, creatorId: 1 },
        $skip: 30,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e}, ${e}name${e}, ${e}creatorId${e} FROM ${e}User${e} ${this.expected$skipClause()}`,
    );
  }

  shouldFind$select() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { password: false } }));
    expect(res.sql).toBe(
      `SELECT ${e}id${e}, ${e}companyId${e}, ${e}creatorId${e}, ${e}createdAt${e}, ${e}updatedAt${e}, ${e}name${e}, ${e}email${e} FROM ${e}User${e}`,
    );

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { name: 0, password: 0 } }));
    expect(res.sql).toBe(
      `SELECT ${e}id${e}, ${e}companyId${e}, ${e}creatorId${e}, ${e}createdAt${e}, ${e}updatedAt${e}, ${e}email${e} FROM ${e}User${e}`,
    );

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: 1, name: 1, password: 0 } }));
    expect(res.sql).toBe(`SELECT ${e}id${e}, ${e}name${e} FROM ${e}User${e}`);

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: 1, name: 0, password: 0 } }));
    expect(res.sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e}`);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw`*`, raw`LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt`.as('hotness')],
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe(
      `SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt ${e}hotness${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)}`,
    );
    expect(res.values).toEqual(['something']);
  }

  /** `/http` casts client JSON straight to `Query`, so a logical operator can arrive as any shape. */
  shouldRejectANonArrayLogicalOperator() {
    for (const [where, got] of [
      [{ $and: 'foo' }, 'string'],
      [{ $or: { name: 'a' } }, 'object'],
      [{ $not: null }, 'null'],
    ] as const) {
      expect(() =>
        this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $where: where as never })),
      ).toThrow(`expects an array, got ${got}`);
    }
  }

  /**
   * A group nested in another is parenthesized, so no clause depends on the engine's precedence and
   * the two spellings of one query - explicit `$and`, or several keys of one object - agree.
   */
  shouldGroupNestedLogicalOperators() {
    const e = this.dialect.escapeIdChar;
    const or = [{ name: 'a' }, { name: 'b' }];
    const expected =
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}companyId${e} = ${this.ph(1)}` +
      ` AND (${e}name${e} = ${this.ph(2)} OR ${e}name${e} = ${this.ph(3)})`;

    const explicit = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { $and: [{ companyId: 1 }, { $or: or }] } }),
    );
    const implicit = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { companyId: 1, $or: or } }),
    );
    expect(explicit.sql).toBe(expected);
    expect(implicit.sql).toBe(expected);
    expect(explicit.values).toEqual([1, 'a', 'b']);

    // A negation applies to the whole group, not just to its first term.
    const negated = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { $not: [{ $or: or }] } }),
    );
    expect(negated.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE NOT (${e}name${e} = ${this.ph(1)} OR ${e}name${e} = ${this.ph(2)})`,
    );

    // An entry that renders nothing leaves no dangling operator behind.
    const empty = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { $and: [{}, { name: 'a' }] } }),
    );
    expect(empty.sql).toBe(`SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)}`);
  }

  shouldDelete() {
    const e = this.dialect.escapeIdChar;
    // Entity without a soft-delete field: always a plain DELETE.
    let res = this.exec((ctx) => this.dialect.delete(ctx, User, { $where: 123 }));
    expect(res.sql).toBe(`DELETE FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)}`);
    expect(res.values).toEqual([123]);

    // `hardDelete` on a non-soft-deletable entity is still a plain DELETE (e.g. a cascade onto one).
    res = this.exec((ctx) => this.dialect.delete(ctx, User, { $where: 123 }, { hardDelete: true }));
    expect(res.sql).toBe(`DELETE FROM ${e}User${e} WHERE ${e}id${e} = ${this.ph(1)}`);
    expect(res.values).toEqual([123]);

    // Soft-deletable entity: UPDATE stamping only live rows.
    res = this.exec((ctx) => this.dialect.delete(ctx, MeasureUnit, { $where: 123 }));
    expect(res.sql).toBe(
      `UPDATE ${e}MeasureUnit${e} SET ${e}deletedAt${e} = ${this.ph(1)} WHERE ${e}id${e} = ${this.ph(2)} AND ${e}deletedAt${e} IS NULL`,
    );
    expect(res.values).toEqual([expect.any(Number), 123]);

    // `hardDelete` removes the row regardless of soft-delete state (no `IS NULL` filter).
    res = this.exec((ctx) => this.dialect.delete(ctx, MeasureUnit, { $where: 123 }, { hardDelete: true }));
    expect(res.sql).toBe(`DELETE FROM ${e}MeasureUnit${e} WHERE ${e}id${e} = ${this.ph(1)}`);
    expect(res.values).toEqual([123]);
  }

  shouldFind$selectRaw() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw(() => 'createdAt', 'hotness')],
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe(`SELECT createdAt ${e}hotness${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)}`);
    expect(res.values).toEqual(['something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw`*`, raw`LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt`.as('hotness')],
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe(
      `SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt ${e}hotness${e} FROM ${e}User${e} WHERE ${e}name${e} = ${this.ph(1)}`,
    );
    expect(res.values).toEqual(['something']);
  }

  shouldFind$whereRaw() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { creatorId: true },
        $where: { $and: [{ companyId: 1 }, raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT `creatorId` FROM `Item` WHERE `companyId` = ? AND SUM(salePrice) > 500');
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [{ companyId: 1 }, { id: 5 }, raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `companyId` = ? OR `id` = ? OR SUM(salePrice) > 500');
    expect(res.values).toEqual([1, 5]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [{ id: 1 }, raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `id` = ? OR SUM(salePrice) > 500');
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [raw`SUM(salePrice) > 500`, { id: 1 }, { companyId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500 OR `id` = ? OR `companyId` = ?');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $and: [raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: raw`SUM(salePrice) > 500`,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { creatorId: true },
        $where: { $or: [{ id: { $in: [1, 2] } }, { code: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `creatorId` FROM `Item` WHERE `id` IN (?, ?) OR `code` = ?');
    expect(res.values).toEqual([1, 2, 'abc']);
  }

  shouldFind$startsWith() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $startsWith: 'Some' } },
        $sort: { name: 'asc', createdAt: 'desc' },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} LIKE ${this.ph(1)} ORDER BY ${e}name${e}, ${e}createdAt${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['Some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $startsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}name${e} LIKE ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['Some%', 'Something']);
  }

  shouldFind$istartsWith() {
    const e = this.dialect.escapeIdChar;
    const one = this.ilikeSql(`${e}name${e}`, 'Some%');
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $istartsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${one.sql} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $istartsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${one.sql} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value, 'Something']);
  }

  shouldFind$endsWith() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $endsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} LIKE ${this.ph(1)} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['%Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $endsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}name${e} LIKE ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['%Some', 'Something']);
  }

  shouldFind$iendsWith() {
    const e = this.dialect.escapeIdChar;
    const one = this.ilikeSql(`${e}name${e}`, '%Some');
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $iendsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${one.sql} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $iendsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${one.sql} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value, 'Something']);
  }

  shouldFind$includes() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $includes: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} LIKE ${this.ph(1)} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['%Some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $includes: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}name${e} LIKE ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['%Some%', 'Something']);
  }

  shouldFind$iincludes() {
    const e = this.dialect.escapeIdChar;
    const one = this.ilikeSql(`${e}name${e}`, '%Some%');
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $iincludes: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${one.sql} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $iincludes: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${one.sql} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value, 'Something']);
  }

  shouldFind$like() {
    const e = this.dialect.escapeIdChar;
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $like: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${e}name${e} LIKE ${this.ph(1)} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $like: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${e}name${e} LIKE ${this.ph(1)} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual(['Some', 'Something']);
  }

  shouldFind$ilike() {
    const e = this.dialect.escapeIdChar;
    const one = this.ilikeSql(`${e}name${e}`, 'Some');
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $ilike: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE ${one.sql} ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: { name: { $ilike: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      `SELECT ${e}id${e} FROM ${e}User${e} WHERE (${one.sql} AND ${this.neSql(`${e}name${e}`, 2)}) ORDER BY ${e}name${e}, ${e}id${e} DESC LIMIT 50 OFFSET 0`,
    );
    expect(res.values).toEqual([one.value, 'Something']);
  }

  shouldFind$regex() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $regex: '^some' } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` REGEXP ?');
    expect(res.values).toEqual(['^some']);
  }

  shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `Item` WHERE MATCH(`name`, `description`) AGAINST(?) AND `companyId` = ? LIMIT 30',
    );
    expect(res.values).toEqual(['some text', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: 1,
        },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      `SELECT \`id\` FROM \`User\` WHERE MATCH(\`name\`) AGAINST(?) AND ${this.neSql('`name`')} AND \`companyId\` = ? LIMIT 10`,
    );
    expect(res.values).toEqual(['something', 'other unwanted', 1]);
  }

  shouldUpdateWithJsonNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: null as any,
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe('UPDATE `Company` SET `kind` = ?, `updatedAt` = ? WHERE `id` = ?');
    expect(values).toEqual([null, 123, 1]);
  }

  shouldHandleRawFalsyValues() {
    const e = this.dialect.escapeIdChar;
    const { sql } = this.exec((ctx) => {
      this.dialect.selectFields(ctx, User, [raw(() => 0, 'zero')]);
    });
    expect(sql).toBe(`0 ${e}zero${e}`);

    const { sql: sql2 } = this.exec((ctx) => {
      this.dialect.selectFields(ctx, User, [raw(() => '', 'empty')]);
    });
    expect(sql2).toBe(` ${e}empty${e}`);
  }

  shouldHandleEmptyAppend() {
    const ctx = this.dialect.createContext();
    ctx.append('SELECT ').append('').append('*');
    expect(ctx.sql).toBe('SELECT *');
  }

  // Aggregate tests - shared across all SQL dialects
  shouldAggregateGroupByWithCount() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
      }),
    );
    expect(sql).toBe(`SELECT ${e}name${e}, COUNT(*) ${e}count${e} FROM ${e}User${e} GROUP BY ${e}name${e}`);
    expect(values).toEqual([]);
  }

  /**
   * A `$having` value that is not an operator map is a value to compare against. Iterating its own
   * keys as operators emitted a dangling `HAVING ` for a `Date` (it has none) and threw on an
   * array's indices.
   */
  shouldAggregate$havingByBareValue() {
    const e = this.dialect.escapeIdChar;
    const byDate = this.exec((ctx) =>
      this.dialect.aggregate(ctx, InventoryAdjustment, {
        $agg: { oldest: { $min: 'date' } },
        $having: { oldest: new Date('2020-01-01T00:00:00.000Z') },
      }),
    );
    expect(byDate.sql).toBe(
      `SELECT MIN(${e}date${e}) ${e}oldest${e} FROM ${e}InventoryAdjustment${e} HAVING MIN(${e}date${e}) = ${this.ph(1)}`,
    );
    expect(byDate.values).toHaveLength(1);

    // an array is the implicit `$in` it is everywhere else, not a map keyed by its indices. How the
    // membership renders is the dialect's own (`IN (?, ?)` against `= ANY($1)`), so only the
    // comparison it hangs off is asserted here.
    const byList = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, { $agg: { n: { $count: '*' } }, $having: { n: [1, 2] } }),
    );
    expect(byList.sql).toContain('HAVING COUNT(*) ');
  }

  /**
   * An aggregate emits its `$group` columns and its `$agg` aliases, and `$having`/`$sort` may name
   * those and nothing else. Falling back to the bare key emitted `HAVING "status" = ?` with no
   * GROUP BY, and an ORDER BY over a column the statement never produced.
   */
  shouldRejectAggregateClausesNamingAColumnItDoesNotEmit() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.aggregate(ctx, User, { $agg: { total: { $count: '*' } }, $having: { name: 'x' } as never }),
      ),
    ).toThrow("cannot $having by 'name': it is neither a $group column nor an $agg alias");

    expect(() =>
      this.exec((ctx) =>
        this.dialect.aggregate(ctx, User, {
          $group: { name: true },
          $agg: { total: { $count: '*' } },
          $sort: { createdAt: -1 } as never,
        }),
      ),
    ).toThrow("cannot $sort by 'createdAt': it is neither a $group column nor an $agg alias");

    // a grouped column and an alias are both legal in either clause
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { total: { $count: '*' } },
        $having: { total: { $gt: 1 } },
        $sort: { name: 1, total: -1 },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) >');
    expect(sql).toContain('ORDER BY');
  }

  shouldAggregateCountDistinct() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { emails: { $countDistinct: 'email' } },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}name${e}, COUNT(DISTINCT ${e}email${e}) ${e}emails${e} FROM ${e}User${e} GROUP BY ${e}name${e}`,
    );
    expect(values).toEqual([]);
  }

  shouldAggregateCountField() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { emails: { $count: 'email' } },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}name${e}, COUNT(${e}email${e}) ${e}emails${e} FROM ${e}User${e} GROUP BY ${e}name${e}`,
    );
    expect(values).toEqual([]);
  }

  shouldAggregateSumDistinct() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { total: { $sumDistinct: 'createdAt' } },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}name${e}, SUM(DISTINCT ${e}createdAt${e}) ${e}total${e} FROM ${e}User${e} GROUP BY ${e}name${e}`,
    );
    expect(values).toEqual([]);
  }

  shouldAggregateAvgDistinct() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { average: { $avgDistinct: 'createdAt' } },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}name${e}, AVG(DISTINCT ${e}createdAt${e}) ${e}average${e} FROM ${e}User${e} GROUP BY ${e}name${e}`,
    );
    expect(values).toEqual([]);
  }

  shouldAggregateGroupByWithMultipleFunctions() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: {
          count: { $count: '*' },
          avgCreated: { $avg: 'createdAt' },
          maxCreated: { $max: 'createdAt' },
          minCreated: { $min: 'createdAt' },
        },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}name${e}, COUNT(*) ${e}count${e}, AVG(${e}createdAt${e}) ${e}avgCreated${e}, MAX(${e}createdAt${e}) ${e}maxCreated${e}, MIN(${e}createdAt${e}) ${e}minCreated${e} FROM ${e}User${e} GROUP BY ${e}name${e}`,
    );
    expect(values).toEqual([]);
  }

  shouldAggregateWithHaving() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $gt: 5 } },
      }),
    );
    expect(sql).toContain(`GROUP BY ${e}name${e} HAVING COUNT(*) > `);
    expect(values).toEqual([5]);
  }

  shouldAggregateWithHavingMultipleConditions() {
    const { values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' }, total: { $sum: 'createdAt' } },
        $having: {
          count: { $gte: 2 },
          total: { $lt: 1000 },
        },
      }),
    );
    expect(values).toEqual([2, 1000]);
  }

  shouldAggregateWithWhereAndSort() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $where: { name: { $ne: null } },
        $sort: { count: -1 },
        $limit: 10,
      }),
    );
    expect(sql).toContain(`${e}name${e} IS NOT NULL`);
    expect(sql).toContain('ORDER BY COUNT(*) DESC LIMIT 10');
    expect(values).toEqual([]);
  }

  shouldAggregateTotalWithoutGroupBy() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $agg: {
          total: { $count: '*' },
          maxCreated: { $max: 'createdAt' },
        },
      }),
    );
    expect(sql).toBe(`SELECT COUNT(*) ${e}total${e}, MAX(${e}createdAt${e}) ${e}maxCreated${e} FROM ${e}User${e}`);
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingBetween() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $between: [2, 10] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) BETWEEN ');
    expect(values).toEqual([2, 10]);
  }

  shouldAggregateWithHavingExactValue() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: 5 },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) = ');
    expect(values).toEqual([5]);
  }

  /**
   * `$having` accepts the full operator vocabulary its type advertises. It used to carry its own
   * partial copy of the WHERE operator dispatch, so a text operator on a `$min`/`$max` type-checked
   * and then threw `unsupported HAVING operator` at runtime.
   */
  shouldAggregateWithHavingTextOperator() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { companyId: true },
        $agg: { biggest: { $max: 'name' } },
        $having: { biggest: { $startsWith: 'A' } },
      }),
    );
    expect(sql).toContain('HAVING MAX(');
    expect(sql).toContain('LIKE ');
    expect(values).toEqual(['A%']);
  }

  /** And it compares against null the way every other operand does, rather than emitting `= NULL`. */
  shouldAggregateWithHavingNullComparison() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { companyId: true },
        $agg: { biggest: { $max: 'name' } },
        $having: { biggest: { $eq: null } },
      }),
    );
    expect(sql).toContain('IS NULL');
    expect(values).toEqual([]);
  }

  shouldAggregateSortByAliasInsteadOfField() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' }, total: { $sum: 'createdAt' } },
        $sort: { count: -1, name: 1 },
      }),
    );
    // `count` should resolve to the aggregate expression COUNT(*), not a column name
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
    expect(sql).toContain('GROUP BY');
  }

  // $distinct tests - shared across all SQL dialects
  shouldFindDistinct() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { name: true },
        $distinct: true,
      }),
    );
    expect(sql).toBe(`SELECT DISTINCT ${e}name${e} FROM ${e}User${e}`);
    expect(values).toEqual([]);
  }

  shouldFindDistinctWithWhereAndSort() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { name: true, email: true },
        $distinct: true,
        $where: { name: { $ne: null } },
        $sort: { name: 1 },
        $limit: 50,
      }),
    );
    expect(sql).toContain('SELECT DISTINCT');
    expect(sql).toContain('IS NOT NULL');
    expect(sql).toContain('LIMIT 50');
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingIn() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $in: [1, 5, 10] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) IN (');
    expect(values).toEqual([1, 5, 10]);
  }

  shouldAggregateWithHavingNin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $nin: [0, 999] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) NOT IN (');
    expect(values).toEqual([0, 999]);
  }

  shouldAggregateWithHavingInEmpty() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $in: [] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) IN (NULL)');
  }

  shouldAggregateWithHavingIsNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { maxVal: { $max: 'createdAt' } },
        $having: { maxVal: { $isNull: true } },
      }),
    );
    expect(sql).toContain('HAVING MAX(');
    expect(sql).toContain(' IS NULL');
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingIsNotNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { maxVal: { $max: 'createdAt' } },
        $having: { maxVal: { $isNotNull: true } },
      }),
    );
    expect(sql).toContain('HAVING MAX(');
    expect(sql).toContain(' IS NOT NULL');
    expect(values).toEqual([]);
  }

  /** `$isNull: false` is the negation of `$isNull: true`, not a no-op. */
  shouldAggregateWithHavingIsNullFalse() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { maxVal: { $max: 'createdAt' } },
        $having: { maxVal: { $isNull: false } },
      }),
    );
    expect(sql).toContain(' IS NOT NULL');
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingIsNotNullFalse() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { maxVal: { $max: 'createdAt' } },
        $having: { maxVal: { $isNotNull: false } },
      }),
    );
    expect(sql).toContain(' IS NULL');
    expect(sql).not.toContain(' IS NOT NULL');
    expect(values).toEqual([]);
  }

  /** `$ne` in `HAVING` uses the same null-safe inequality the `WHERE` builder does. */
  shouldAggregateWithHavingNe() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $ne: 5 } },
      }),
    );
    expect(sql).toContain(`HAVING ${this.neSql('COUNT(*)')}`);
    expect(values).toEqual([5]);
  }

  /** Several operators on one alias AND together, each repeating the aggregate expression. */
  shouldAggregateWithHavingMultipleOperatorsOnSameAlias() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { count: { $gt: 2, $lte: 10 } },
      }),
    );
    expect(sql).toContain(`HAVING COUNT(*) > ${this.ph(1)} AND COUNT(*) <= ${this.ph(2)}`);
    expect(values).toEqual([2, 10]);
  }

  /** A `$having` alias that is not an aggregate falls back to the grouped column. */
  shouldAggregateWithHavingOnGroupedColumn() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $having: { name: 'maz' },
      }),
    );
    expect(sql).toContain(`HAVING ${e}name${e} = ${this.ph(1)}`);
    expect(values).toEqual(['maz']);
  }

  shouldRejectUnsupportedHavingOperator() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.aggregate(ctx, User, {
          $group: { name: true },
          $agg: { count: { $count: '*' } },
          $having: { count: { $bogus: 5 } } as never,
        }),
      ),
    ).toThrow('unsupported HAVING operator: $bogus');
  }

  shouldAggregateSortWithNumericNegativeOne() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $sort: { count: -1 },
      }),
    );
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
  }

  shouldAggregateSortWithMixedDirections() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' }, total: { $sum: 'createdAt' } },
        $sort: { count: 'desc', name: 'asc', total: 1 },
      }),
    );
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
    expect(sql).toContain('SUM(');
    expect(sql).not.toContain('SUM(' + this.dialect.escapeIdChar + 'createdAt' + this.dialect.escapeIdChar + ') DESC');
  }

  shouldAggregateWithPagination() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $agg: { count: { $count: '*' } },
        $sort: { count: -1 },
        $skip: 20,
        $limit: 10,
      }),
    );
    expect(sql).toContain(`GROUP BY ${e}name${e}`);
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
    expect(sql).toContain('LIMIT 10');
    expect(sql).toContain('OFFSET 20');
    expect(values).toEqual([]);
  }

  shouldThrowOnEmptyAggregate() {
    expect(() => this.exec((ctx) => this.dialect.aggregate(ctx, User, {}))).toThrow(
      'aggregate requires at least one $group column or $agg function',
    );
  }

  /**
   * Regression: `jsonElemFrom`/`jsonElemRef` used to hardcode one fixed alias for the derived table
   * a JSON array explodes into. A nested `$elemMatch` (matching an array-of-arrays, reachable today
   * only by bypassing the type system) recurses into the same hook a second time within one query -
   * confirmed live against SQLite and MySQL that reusing one literal alias at both nesting depths
   * let the inner occurrence shadow the outer one it needed to correlate against, silently returning
   * zero rows instead of the matching ones. Each nesting level must get its own alias, generated
   * from `ctx.nextAlias`, so this only asserts they're distinct - not full result correctness, which
   * is a per-dialect SQL-generation concern already covered where reachable via the typed API.
   */
  shouldGenerateDistinctAliasesForNestedElemMatch() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { $elemMatch: { $eq: 5 } } } } as any,
      }),
    );
    const aliases = new Set(sql.match(/_uql_elem_\d+/g));
    expect(aliases.size).toBe(2);
  }
}
