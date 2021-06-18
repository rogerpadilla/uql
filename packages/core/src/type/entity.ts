import { Type } from './utility';

export type FieldValue<E> = E[FieldKey<E>];

export type FieldKey<E> = {
  readonly [K in Key<E>]: E[K] extends object ? never : K;
}[Key<E>];

export type RelationValue<E> = E[RelationKey<E>];

export type RelationKey<E> = {
  readonly [K in Key<E>]: E[K] extends object ? K : never;
}[Key<E>];

export type Key<E> = {
  readonly [K in keyof E]: K & string;
}[keyof E & string];

export type EntityOptions = {
  readonly name?: string;
};

export type FieldOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: EntityGetter | ReferenceOptions;
  readonly onInsert?: () => any;
  readonly onUpdate?: () => any;
};

export type IdOptions = Omit<FieldOptions, 'isId' | 'reference'>;

export type EntityGetter<E = any> = () => Type<E>;

export type ReferenceOptions<E = any> = { entity: EntityGetter<E> };

export type CascadeType = 'persist' | 'delete';

export type RelationOptions<E = any> = {
  entity?: EntityGetter<E>;
  readonly cardinality?: RelationCardinality;
  readonly cascade?: boolean | readonly CascadeType[];
  mappedBy?: RelationMappedBy<E>;
  through?: EntityGetter<RelationValue<E>>;
  references?: RelationReferences;
};

type RelationOptionsOwner<E> = Pick<RelationOptions<E>, 'entity' | 'references' | 'cascade'>;
type RelationOptionsInverseSide<E> = Pick<RelationOptions<E>, 'entity' | 'mappedBy' | 'cascade'>;
type RelationOptionsThroughOwner<E> = Pick<RelationOptions<E>, 'entity' | 'through' | 'references' | 'cascade'>;

export type KeyMap<E> = { readonly [K in Key<E>]: Key<E> };

export type KeyMapper<E> = (keyMap: KeyMap<E>) => Key<E>;

export type RelationReferences = { source: string; target: string }[];

export type RelationMappedBy<E> = E extends object ? Key<E> | KeyMapper<E> : Key<E>;

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationOneToManyOptions<E> =
  | RelationOptionsOwner<E>
  | RelationOptionsInverseSide<E>
  | RelationOptionsThroughOwner<E>;

export type RelationManyToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationManyToManyOptions<E> = RelationOptionsThroughOwner<E> | RelationOptionsInverseSide<E>;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name: string;
  id?: FieldKey<E>;
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  };
  relations: {
    [K in RelationKey<E>]?: RelationOptions;
  };
  processed?: boolean;
};
