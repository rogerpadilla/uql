export type EntityOptions = {
  readonly name?: string;
};

export type PropertyOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: { entity: () => { new (): any } };
  readonly onInsert?: () => any;
  readonly onUpdate?: () => any;
};

type IdPropertyOptions = { readonly property: string } & PropertyOptions;

export type RelationOptions<E> = {
  entity?: () => { new (): any };
  readonly cardinality: RelationCardinality;
  readonly mappedBy?: keyof E;
  through?: string;
  references?: { source: string; target: string }[];
};

export type RelationCardinality = 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
export type RelationOneToOneOptions<E> = { entity?: () => { new (): E }; mappedBy?: keyof E };
export type RelationOneToManyOptions<E> = { entity: () => { new (): E }; mappedBy?: keyof E };
export type RelationManyToOneOptions<E> = { entity?: () => { new (): E } };
export type RelationManyToManyOptions<E> = { entity: () => { new (): E } };

export type EntityMeta<E> = {
  readonly entity: { new (): E };
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
