import { Type } from './utility';

export type Properties<E> = {
  readonly [K in keyof E]: E[K] extends object ? never : K;
}[keyof E & string];

export type Relations<E> = {
  readonly [K in keyof E]: E[K] extends object ? K : never;
}[keyof E & string];

export type Keys<E> = {
  readonly [K in keyof E]: K;
}[keyof E & string];

export type EntityOptions = {
  readonly name?: string;
};

export type PropertyOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: EntityGetter | ReferenceOptions;
  readonly onInsert?: () => any;
  readonly onUpdate?: () => any;
};

export type EntityGetter<E = any> = () => Type<E>;

export type ReferenceOptions<E = any> = { entity: EntityGetter<E> };

export type CascadeType = 'insert' | 'update' | 'delete' | 'softDelete' | 'recover';

export type RelationOptions<E = any> = {
  entity?: EntityGetter<E>;
  readonly cardinality?: RelationCardinality;
  readonly cascade?: boolean | readonly CascadeType[];
  mappedBy?: RelationMappedBy<E>;
  through?: EntityGetter<any>;
  references?: RelationReferences;
};

type RelationOptionsOwner<E> = Pick<RelationOptions<E>, 'entity' | 'references' | 'cascade'>;
type RelationOptionsInverseSide<E> = Pick<RelationOptions<E>, 'entity' | 'mappedBy' | 'cascade'>;
type RelationOptionsThroughOwner<E> = Pick<RelationOptions<E>, 'entity' | 'through' | 'references' | 'cascade'>;

export type KeyMap<E> = { readonly [K in Keys<E>]: Keys<E> };

export type KeyMapper<E> = (keyMap: KeyMap<E>) => Keys<E>;

export type RelationReferences = { source: string; target: string }[];

export type RelationMappedBy<E> = E extends object ? Keys<E> | KeyMapper<E> : Keys<E>;

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
  id?: Properties<E>;
  properties: {
    [P in Properties<E>]?: PropertyOptions;
  };
  relations: {
    [R in Relations<E> & string]?: RelationOptions;
  };
  processed?: boolean;
};
