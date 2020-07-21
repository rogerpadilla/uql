export type EntityOptions = {
  readonly name?: string;
};

export type PropertyOptions<T> = {
  readonly column: ColumnOptions<T>;
  readonly relation: RelationOptions<T>;
};

export type ColumnOptions<T> = {
  readonly property?: string;
  readonly name?: string;
  readonly isId?: boolean;
  readonly onInsert?: () => any;
  readonly onUpdate?: () => any;
};

export type RelationOptions<T> = {
  readonly property?: string;
  type?: () => { new (): any };
  readonly cardinality: RelationCardinality;
  readonly mappedBy?: keyof T;
};

export type RelationCardinality = 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
export type RelationOneToOneOptions<T> = { type?: () => { new (): T }; mappedBy: keyof T };
export type RelationOneToManyOptions<T> = { type: () => { new (): T }; mappedBy: keyof T };
export type RelationManyToOneOptions<T> = { type?: () => { new (): T } };
export type RelationManyToManyOptions<T> = { type: () => { new (): T } };

export type EntityMeta<T> = {
  readonly type: { new (): T };
  name: string;
  readonly id?: ColumnOptions<T>;
  isEntity?: boolean;
  /**
   * 'properties' contains both, columns and relations metadata
   */
  properties: {
    [key: string]: PropertyOptions<T>;
  };
  /**
   * readonly shorthand for accesing 'columns' metadata
   */
  readonly columns?: {
    [key: string]: ColumnOptions<T>;
  };
  /**
   * readonly shorthand for accesing 'relations' metadata
   */
  readonly relations?: {
    [key: string]: RelationOptions<T>;
  };
};
