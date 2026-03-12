import type { IndexType } from '../../schema/types.js';
import type { Type, VectorIndexOptions } from '../../type/index.js';
import { getOrCreateMeta } from './definition.js';

/**
 * Options for the @Index decorator.
 */
export interface IndexDecoratorOptions extends VectorIndexOptions {
  /** Custom index name */
  name?: string;
  /** Whether index is unique */
  unique?: boolean;
  /** Index type */
  type?: IndexType;
  /** Partial index WHERE clause */
  where?: string;
}

/**
 * Define a composite index on an entity class.
 *
 * @example
 * ```ts
 * @Index(['lastName', 'firstName'], { name: 'idx_users_fullname' })
 * @Entity()
 * export class User {
 *   @Id() id?: number;
 *   @Field() firstName?: string;
 *   @Field() lastName?: string;
 * }
 *
 * // With unique and partial index
 * @Index(['email'], { unique: true })
 * @Index(['status'], { where: "status = 'active'" })
 * @Entity()
 * export class User { ... }
 * ```
 */
export function Index<E>(columns: string[], options: IndexDecoratorOptions = {}) {
  return (target: Type<E>): void => {
    const meta = getOrCreateMeta(target);
    if (!meta.indexes) {
      meta.indexes = [];
    }
    meta.indexes.push({ ...options, columns, unique: options.unique ?? false });
  };
}
