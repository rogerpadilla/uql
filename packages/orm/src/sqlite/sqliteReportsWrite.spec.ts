import { describe, expect, it } from 'vitest';
import { Entity, f, Field, getMeta } from '../entity/index.js';
import { insertInto } from '../util/triggerWrite.js';
import { SqliteDialect } from './sqliteDialect.js';

@Entity({ name: 'SqliteReportAudit' })
class SqliteReportAudit {
  @Field(f.number().id()) id?: number;
  @Field(f.number().nullable()) postId?: number | null;
}

@Entity({
  name: 'SqliteReportPost',
  triggers: (post, trigger) => [
    trigger({
      on: 'afterUpdate',
      of: [post.id],
      name: 'audit',
      run: (newRow) => insertInto(SqliteReportAudit, { postId: newRow.id }),
    }),
  ],
})
class SqliteReportPost {
  @Field(f.number().id()) id?: number;
  @Field(f.string()) title!: string;
}

@Entity({ name: 'SqliteReportPlain' })
class SqliteReportPlain {
  @Field(f.number().id()) id?: number;
  @Field(f.string()) title!: string;
}

describe('SqliteDialect reportsWrite', () => {
  it('should not report an update of a row an authored trigger may change', () => {
    expect(new SqliteDialect().reportsWrite(getMeta(SqliteReportPost), 'update')).toBe(false);
  });

  it('should report an update of a row no trigger or stamp touches', () => {
    expect(new SqliteDialect().reportsWrite(getMeta(SqliteReportPlain), 'update')).toBe(true);
  });
});
