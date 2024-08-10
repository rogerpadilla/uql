import { QueryRaw } from './query.js';
import { Scalar, Type } from './utility.js';

/**
 * Allow to customize the name of the property that identifies an entity
 */
export const idKey = Symbol('idKey');

/**
 * Infers the key names of an entity
 */
export type Key<E> = keyof E & string;

/**
 * Infers the field names of an entity
 */
export type FieldKey<E> = {
  readonly [K in keyof E]: E[K] extends Scalar ? K : never;
}[Key<E>];

/**
 * Infers the relation names of an entity
 */
export type RelationKey<E> = {
  readonly [K in keyof E]: E[K] extends Scalar ? never : K;
}[Key<E>];

/**
 * Infers the field values of an entity
 */
export type FieldValue<E> = E[FieldKey<E>];

/**
 * Infers the name of the key identifier on an entity
 */
export type IdKey<E> = E extends { [idKey]?: infer K }
  ? K & FieldKey<E>
  : E extends { _id?: unknown }
    ? '_id' & FieldKey<E>
    : E extends { id?: unknown }
      ? 'id' & FieldKey<E>
      : E extends { uuid?: unknown }
        ? 'uuid' & FieldKey<E>
        : FieldKey<E>;

/**
 * Infers the value of the key identifier on an entity
 */
export type IdValue<E> = E[IdKey<E>];

/**
 * Infers the values of the relations on an entity
 */
export type RelationValue<E> = E[RelationKey<E>];

/**
 * Configurable options for an entity
 */
export type EntityOptions = {
  readonly name?: string;
  readonly softDelete?: boolean;
};

/**
 * Configurable options for a field
 */
export type FieldOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: EntityGetter;
  readonly virtual?: QueryRaw;
  readonly onInsert?: OnFieldCallback;
  readonly onUpdate?: OnFieldCallback;
  readonly onDelete?: OnFieldCallback;

  // TODO implemente support for following fields
  // readonly allowNull?: boolean;
  // readonly defaultValue?: Scalar;
  // readonly isAutoIncrement?: boolean;
  // readonly comment?: string;
};

export type OnFieldCallback = Scalar | QueryRaw | (() => Scalar | QueryRaw);

export type EntityGetter<E = any> = () => Type<E>;

export type CascadeType = 'persist' | 'delete';

export type RelationOptions<E = any> = {
  entity?: EntityGetter<E>;
  cardinality: RelationCardinality;
  readonly cascade?: boolean | CascadeType;
  mappedBy?: RelationMappedBy<E>;
  through?: EntityGetter<RelationValue<E>>;
  references?: RelationReferences;
};

type RelationOptionsOwner<E> = Pick<RelationOptions<E>, 'entity' | 'references' | 'cascade'>;
type RelationOptionsInverseSide<E> = Required<Pick<RelationOptions<E>, 'entity' | 'mappedBy'>> &
  Pick<RelationOptions<E>, 'cascade'>;
type RelationOptionsThroughOwner<E> = Required<Pick<RelationOptions<E>, 'entity'>> &
  Pick<RelationOptions<E>, 'through' | 'references' | 'cascade'>;

export type RelationKeyMap<E> = { readonly [K in keyof E]: K };

export type RelationKeyMapper<E> = (keyMap: RelationKeyMap<E>) => Key<E>;

export type RelationReferences = { readonly local: string; readonly foreign: string }[];

export type RelationMappedBy<E> = Key<E> | RelationKeyMapper<E>;

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationOneToManyOptions<E> = RelationOptionsInverseSide<E> | RelationOptionsThroughOwner<E>;

export type RelationManyToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationManyToManyOptions<E> = RelationOptionsThroughOwner<E> | RelationOptionsInverseSide<E>;

/**
 * Wrapper type for relation type definitions in entities.
 * Used to circumvent ESM modules circular dependency issue caused by reflection metadata saving the type of the property.
 *
 * Usage example:
 * @Entity()
 * export default class User {
 *
 *     @OneToOne(() => Profile, profile => profile.user)
 *     profile: Relation<Profile>;
 *
 * }
 */
export type Relation<T> = T;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name?: string;
  id?: IdKey<E>;
  softDelete?: FieldKey<E>;
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  };
  relations: {
    [K in RelationKey<E>]?: RelationOptions;
  };
  processed?: boolean;
};
