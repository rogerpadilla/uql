import type { EntityIndexMeta, EntityMeta, Type } from '../../type/index.js';

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

// Use the same meta holder as definition.ts
const holder = globalThis;
const metaKey = '@uql/core/entity/decorator';

function getOrCreateMeta<E>(entity: Type<E>): EntityMeta<E> {
  const metas: Map<Type<unknown>, EntityMeta<any>> = holder[metaKey] ?? new Map();
  holder[metaKey] = metas;

  let meta = metas.get(entity);
  if (!meta) {
    meta = { entity, fields: {}, relations: {} };
    metas.set(entity, meta);
  }
  return meta;
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
