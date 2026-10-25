import type { ColumnFactory } from '../type/index.js';
import { columns } from './columnOptionsBuilder.js';

/** Declares a column, `f.string()`, its options chained: `f.number().nullable().default(0)`. See the entities guide. */
export const f: ColumnFactory = columns;
