import { getMeta } from '@uql/core/entity';
import { Query, Type, QueryCriteria, QueryOptions, IdValue, QueryUpdateResult, Column, IsolationLevel, Table, Scalar } from '@uql/core/type';
import { unflatObjects, clone } from '@uql/core/util';
import { AbstractSqlDialect } from '@uql/core/dialect';

import { AbstractQuerier } from './abstractQuerier';

export abstract class AbstractSqlQuerier extends AbstractQuerier {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: AbstractSqlDialect) {
    super();
  }

  /**
   * read query.
   * @param query the query
   */
  abstract all<T>(query: string): Promise<T[]>;

  /**
   * insert/update/delete/ddl query.
   * @param query the query
   */
  abstract run(query: string): Promise<QueryUpdateResult>;

  override async count<E>(entity: Type<E>, qm?: QueryCriteria<E>) {
    const query = await this.dialect.count(entity, qm);
    const res: any = await this.all<E>(query);
    return Number(res[0].count);
  }

  override async findMany<E>(entity: Type<E>, qm: Query<E>) {
    const query = this.dialect.find(entity, qm);
    const res = await this.all<E>(query);
    const founds = unflatObjects(res);
    await this.findToManyRelations(entity, founds, qm.$project);
    return founds;
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    payload = clone(payload);
    const query = this.dialect.insert(entity, payload);
    const { firstId } = await this.run(query);
    const meta = getMeta(entity);
    const ids: IdValue<E>[] = payload.map((it, index) => {
      it[meta.id as string] ??= firstId + index;
      return it[meta.id];
    });
    await this.insertRelations(entity, payload);
    return ids;
  }

  override async updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E) {
    payload = clone(payload);
    const query = this.dialect.update(entity, qm, payload);
    const { changes } = await this.run(query);
    await this.updateRelations(entity, qm, payload);
    return changes;
  }

  override async deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    const findQuery = await this.dialect.find(entity, { ...qm, $project: [meta.id] });
    const founds = await this.all<E>(findQuery);
    if (!founds.length) {
      return 0;
    }
    const ids: IdValue<E>[] = founds.map((it) => it[meta.id]);
    const query = this.dialect.delete(entity, { $filter: ids }, opts);
    const { changes } = await this.run(query);
    await this.deleteRelations(entity, ids, opts);
    return changes;
  }

  override get hasOpenTransaction() {
    return this.hasPendingTransaction;
  }

  override async beginTransaction(/*isolationLevel?: IsolationLevel*/) {
    if (this.hasPendingTransaction) {
      throw TypeError('pending transaction');
    }
    // TODO
    // if (isolationLevel) {
    //   await this.run(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    // }
    await this.run(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  override async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw TypeError('not a pending transaction');
    }
    await this.run('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  override async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw TypeError('not a pending transaction');
    }
    await this.run('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }

  async createTable(table: Table) {
    const sql = `CREATE TABLE IF NOT EXISTS ${this.escapeId(table.name)}`;
    await this.run(sql);
  }

  override listTables() {
    const sql = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = DATABASE()`;
    return this.all<string>(sql);
  }

  override async clearTable(table: string) {
    await this.run(`TRUNCATE TABLE ${this.escapeId(table)}`);
  }

  override async clearTables(tables?: string[]) {
    if (!tables) {
      tables = await this.listTables();
    }
    await Promise.all(tables.map((table) => this.clearTable(table)));
  }

  override async dropTable(table: string) {
    await this.run(`DROP TABLE IF EXISTS ${this.escapeId(table)}`);
  }

  override async dropTables(tables?: string[]) {
    if (!tables) {
      tables = await this.listTables();
    }
    await Promise.all(tables.map((table) => this.dropTable(table)));
  }

  override async renameTable(oldTable: string, newTable: string) {
    await this.run(`ALTER TABLE ${this.escapeId(oldTable)} RENAME TO ${this.escapeId(newTable)}`);
  }

  override async addColumn(table: string, column: string, options: Column) {
    const sqlOptions = this.columnOptionsToSql(options);
    await this.run(`ALTER TABLE ${this.escapeId(table)} ADD COLUMN ${this.escapeId(column)}${sqlOptions}`);
  }

  override async dropColumn(table: string, column: string) {
    await this.run(`ALTER TABLE ${this.escapeId(table)} DROP COLUMN ${this.escapeId(column)}`);
  }

  override async changeColumn(table: string, column: string, options?: Column) {
    await this.run(``);
  }

  override async renameColumn(table: string, oldColumn: string, newColumn: string) {
    await this.run(`ALTER TABLE ${this.escapeId(table)} RENAME COLUMN ${this.escapeId(oldColumn)} TO ${this.escapeId(newColumn)}`);
  }

  columnOptionsToSql(opts: Column) {
    let sql = '';
    if (opts.required) {
      sql += ' NOT NULL';
    }
    if (opts.autoIncrement) {
      sql += ' AUTO_INCREMENT';
    }
    if (opts.default) {
      sql += ` DEFAULT ${this.escape(opts.default)}`;
    }
    if (opts.unique) {
      sql += ' UNIQUE';
    }
    if (opts.primary) {
      sql += ' PRIMARY KEY';
    }
    if (opts.comment) {
      sql += ` COMMENT ${this.escape(opts.comment)}`;
    }
    if (opts.references) {
      sql += ` REFERENCES ${this.escapeId(opts.references.table)}`;
      if (opts.references.field) {
        sql += ` (${this.escapeId(opts.references.field)})`;
      } else {
        sql += ` (${this.escapeId('id')})`;
      }
      if (opts.onDelete) {
        sql += ` ON DELETE ${opts.onDelete}`;
      }
      if (opts.onUpdate) {
        sql += ` ON UPDATE ${opts.onUpdate}`;
      }
    }
    if (opts.charset) {
      sql += ` CHARACTER SET "${opts.charset}"`;
    }
    if (opts.collate) {
      sql += ` COLLATE "${opts.collate}"`;
    }
    return sql;
  }

  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean) {
    return this.dialect.escapeId(val, forbidQualified, addDot);
  }

  escape(value: any): Scalar {
    return this.dialect.escape(value);
  }
}
