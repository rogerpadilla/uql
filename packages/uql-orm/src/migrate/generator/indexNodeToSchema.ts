import { isVectorCategory } from '../../schema/canonicalType.js';
import { indexColumns } from '../../schema/indexColumns.js';
import type { IndexNode } from '../../schema/types.js';
import type { IndexSchema } from '../../type/index.js';

/**
 * An AST index as the generators and dialects want it. Spread rather than copied field by field:
 * rebuilding it by hand is how the partial-index `where` once vanished without a trace. The node-only
 * keys (`table`, `source`, `syncStatus`) are ignored downstream, and the vector type travels along
 * because pgvector's operator-class names are built from it.
 */
export function indexNodeToSchema(index: IndexNode): IndexSchema {
  return {
    ...index,
    vectorType: indexColumns(index)
      .map((col) => col.type?.category)
      .find(isVectorCategory),
  };
}
