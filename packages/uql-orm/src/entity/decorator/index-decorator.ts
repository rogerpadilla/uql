import type { EntityIndexMeta, Type } from '../../type/index.js';
import { getOrCreateMeta } from './definition.js';

/**
 * Options for the @Index decorator.
 */
export interface IndexDecoratorOptions {
  /** Custom index name */
  name?: string;
  /** Whether index is unique */
  unique?: boolean;
  /** Index type (btree, hash, gin, gist) */
  type?: 'btree' | 'hash' | 'gin' | 'gist';
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

    // Initialize indexes array if not exists
    if (!meta.indexes) {
      meta.indexes = [];
    }

    const indexDef: EntityIndexMeta = {
      columns,
      name: options.name,
      unique: options.unique ?? false,
      type: options.type,
      where: options.where,
    };

    meta.indexes.push(indexDef);
  };
}
