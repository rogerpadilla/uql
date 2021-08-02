import { QueryRaw, QueryRawFnOptions } from './query';
import { Scalar, Type } from './utility';

export type Key<E> = {
  readonly [K in keyof E]: K & string;
}[keyof E & string];

export type FieldKey<E> = {
  readonly [K in Key<E>]: E[K] extends Scalar ? K : never;
}[Key<E>];

export type FieldValue<E> = E[FieldKey<E>];

export const idKey = Symbol('idKey');

export type IdValue<E> = E extends { [idKey]?: infer U }
  ? U
  : E extends { id?: infer U }
  ? U
  : E extends { _id?: infer U }
  ? U & string
  : FieldValue<E>;

export type RelationKey<E> = {
  readonly [K in Key<E>]: E[K] extends Scalar ? never : K;
}[Key<E>];

export type RelationValue<E> = E[RelationKey<E>];

export type EntityOptions = {
  readonly name?: string;
  readonly softDelete?: boolean;
};

export type FieldOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: EntityGetter | ReferenceOptions;
  readonly virtual?: QueryRaw;
  readonly onInsert?: OnFieldCallback;
  readonly onUpdate?: OnFieldCallback;
  readonly onDelete?: OnFieldCallback;
};

export type OnFieldCallback = (opts?: QueryRawFnOptions) => Scalar;

export type EntityGetter<E = any> = () => Type<E>;

export type ReferenceOptions<E = any> = { entity: EntityGetter<E> };

export type CascadeType = 'persist' | 'delete';

export type RelationOptions<E = any> = {
  entity?: EntityGetter<E>;
  readonly cardinality?: RelationCardinality;
  readonly cascade?: boolean | CascadeType;
  mappedBy?: RelationMappedBy<E>;
  through?: EntityGetter<RelationValue<E>>;
  references?: RelationReferences;
};

type RelationOptionsOwner<E> = Pick<RelationOptions<E>, 'entity' | 'references' | 'cascade'>;
type RelationOptionsInverseSide<E> = Pick<RelationOptions<E>, 'entity' | 'mappedBy' | 'cascade'>;
type RelationOptionsThroughOwner<E> = Pick<RelationOptions<E>, 'entity' | 'through' | 'references' | 'cascade'>;

export type RelationKeyMap<E> = { readonly [K in RelationKey<E>]: K };

export type RelationKeyMapper<E> = (keyMap: RelationKeyMap<E>) => RelationKey<E>;

export type RelationReferences = { local: string; foreign: string }[];

export type RelationMappedBy<E> = RelationKey<E> | RelationKeyMapper<E>;

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationOneToManyOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E> | RelationOptionsThroughOwner<E>;

export type RelationManyToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationManyToManyOptions<E> = RelationOptionsThroughOwner<E> | RelationOptionsInverseSide<E>;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name: string;
  id?: FieldKey<E>;
  softDelete?: FieldKey<E>;
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  };
  relations: {
    [K in RelationKey<E>]?: RelationOptions;
  };
  processed?: boolean;
};

// TODO
// export interface NamingStrategy {
//   tableName<T>(entity: Type<T>): string;
//   columnName<T>(entity: Type<T>, fieldName: string): string;
//   referenceColumnName<T>(sourceEntity: Type<T>, targetEntity: string, fieldName: string): string;
// }
