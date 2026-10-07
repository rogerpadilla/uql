import type { IndexSchema } from '../../type/index.js';
import { IndexDdl } from './indexDdl.js';

/** SQL Server's `CREATE INDEX`, the portable form less what 2025 rejects, which its capabilities state. */
export class MsSqlIndexDdl extends IndexDdl {
  /** T-SQL has no `IF NOT EXISTS` on an index, so the create is guarded by a lookup in the same statement. */
  override getCreateIndexStatement(
    tableName: string,
    index: IndexSchema,
    opts: { ifNotExists?: boolean } = {},
  ): string {
    const create = super.getCreateIndexStatement(tableName, index, { ifNotExists: false });
    if (!(opts.ifNotExists ?? this.dialect.features.indexIfNotExists)) {
      return create;
    }
    const table = this.dialect.escape(this.dialect.escapeId(tableName));
    const name = this.dialect.escape(index.name);
    return `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${name} AND object_id = OBJECT_ID(${table})) ${create}`;
  }
}
