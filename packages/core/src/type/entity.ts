import { Type } from './utility';

export type Properties<E> = {
  [K in keyof E]: E[K] extends object ? never : K;
}[keyof E];

export type Relations<E> = {
  [K in keyof E]: E[K] extends object ? K : never;
}[keyof E];

export type EntityOptions = {
  readonly name?: string;
};

export type PropertyOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: { entity: () => Type<any> };
  readonly onInsert?: () => any;
  readonly onUpdate?: () => any;
};

type IdPropertyOptions = { readonly property: string } & PropertyOptions;

export type RelationOptions<E> = {
  entity?: () => Type<E>;
  readonly cardinality: RelationCardinality;
  mappedBy?: RelationMappedBy<E>;
  through?: string;
  references?: { source: string; target: string }[];
};

export type PropertyNameMap<E> = { readonly [K in keyof E]: K };
export type PropertyNameMapper<E> = (namesMap: PropertyNameMap<E>) => string;
export type RelationMappedBy<E> = E extends object ? keyof E | PropertyNameMapper<E> : string;
export type RelationCardinality = 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
export type RelationOneToOneOptions<E> = { entity?: () => Type<E>; mappedBy?: RelationMappedBy<E> };
export type RelationOneToManyOptions<E> = { entity: () => Type<E>; mappedBy?: RelationMappedBy<E> };
export type RelationManyToOneOptions<E> = { entity?: () => Type<E> };
export type RelationManyToManyOptions<E> = { entity: () => Type<E> };

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name: string;
  id?: IdPropertyOptions;
  properties: {
    [key: string]: PropertyOptions;
  };
  relations: {
    [key: string]: RelationOptions<E>;
  };
  processed?: boolean;
};
