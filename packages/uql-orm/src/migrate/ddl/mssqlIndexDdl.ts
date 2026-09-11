import type { IndexType } from '../../schema/types.js';
import type { IndexFeature } from '../../type/index.js';
import { IndexDdl } from './indexDdl.js';

/**
 * SQL Server's `CREATE INDEX` is the portable form minus what 2025 rejects: an expression (Msg 16216),
 * the subquery a JSON path compiles to (Msg 1046), and any type but the plain rowstore B-tree, since
 * the index built in its place fails on a `VECTOR` or `nvarchar(max)` column (Msg 1978).
 */
export class MsSqlIndexDdl extends IndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>(['partial']);

  protected override readonly indexTypes = new Set<IndexType>(['btree']);
}
