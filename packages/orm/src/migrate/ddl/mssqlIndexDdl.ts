import type { IndexType } from '../../schema/types.js';
import type { IndexFeature, IndexSchema } from '../../type/index.js';
import { IndexDdl } from './indexDdl.js';

/**
 * SQL Server's `CREATE INDEX` is the portable form minus what 2025 rejects: an expression (Msg 16216),
 * the subquery a JSON path compiles to (Msg 1046), and any type but the plain rowstore B-tree, since
 * the index built in its place fails on a `VECTOR` or `nvarchar(max)` column (Msg 1978).
 */
export class MsSqlIndexDdl extends IndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>(['partial']);

  protected override readonly indexTypes = new Set<IndexType>(['btree']);

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
