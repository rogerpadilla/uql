export type EntityOptions = {
  readonly name?: string;
};

export type PropertyOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: any;
  readonly reference?: { type: () => { new (): any } };
  readonly onInsert?: () => any;
  readonly onUpdate?: () => any;
};

type IdPropertyOptions = { readonly property: string } & PropertyOptions;

export type RelationOptions<T> = {
  type?: () => { new (): any };
  readonly cardinality: RelationCardinality;
  readonly mappedBy?: keyof T;
  through?: string;
  references?: { source: string; target: string }[];
};

export type RelationCardinality = 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
export type RelationOneToOneOptions<T> = { type?: () => { new (): T }; mappedBy?: keyof T };
export type RelationOneToManyOptions<T> = { type: () => { new (): T }; mappedBy?: keyof T };
export type RelationManyToOneOptions<T> = { type?: () => { new (): T } };
export type RelationManyToManyOptions<T> = { type: () => { new (): T } };

export type EntityMeta<T> = {
  readonly type: { new (): T };
  name: string;
  id?: IdPropertyOptions;
  properties: {
    [key: string]: PropertyOptions;
  };
  relations: {
    [key: string]: RelationOptions<T>;
  };
  processed?: true;
};
