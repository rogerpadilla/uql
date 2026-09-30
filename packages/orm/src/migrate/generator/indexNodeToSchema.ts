import { isVectorCategory } from '../../schema/canonicalType.js';
import { indexColumns } from '../../schema/indexColumns.js';
import type { IndexNode } from '../../schema/types.js';
import type { IndexSchema } from '../../type/index.js';

/**
 * An AST index in the form generators and dialects take. It is spread rather than copied field by field, so
 * no field (such as a partial index's `where`) is lost. It drops `table`, a link back into the graph that a
 * plan cannot carry as JSON, and adds the vector type, from which pgvector's operator-class names are built.
 */
export function indexNodeToSchema(index: IndexNode): IndexSchema {
  const { table: _table, ...schema } = index;
  return {
    ...schema,
    vectorType: indexColumns(index)
      .map((col) => col.type?.category)
      .find(isVectorCategory),
  };
}
