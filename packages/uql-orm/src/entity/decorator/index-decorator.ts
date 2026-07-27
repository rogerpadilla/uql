import type { DistributiveOmit, EntityIndexMeta, Type } from '../../type/index.js';
import { defineIndex } from '../metadata/definition.js';

/**
 * Options for the @Index decorator - {@link EntityIndexMeta} minus `columns`, which the decorator
 * takes as its own positional argument. `DistributiveOmit` (not plain `Omit`) keeps `type`/`distance`
 * a discriminated pair - `EntityIndexMeta`'s vector-index invariant, that omitting `distance` on a
 * vector index type is a compile error.
 */
export type IndexDecoratorOptions = DistributiveOmit<EntityIndexMeta, 'columns'>;

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
    defineIndex(target, { ...options, columns });
  };
}
