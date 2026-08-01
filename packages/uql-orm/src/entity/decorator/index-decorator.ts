import type { IndexColumnInput, IndexOptions, Type } from '../../type/index.js';
import { defineIndex } from '../metadata/definition.js';

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
export function Index<E>(columns: readonly IndexColumnInput[], options: IndexOptions = {}) {
  return (target: Type<E>): void => {
    defineIndex(target, { ...options, columns });
  };
}
