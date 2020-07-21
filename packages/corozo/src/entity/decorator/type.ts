export type EntityOptions = {
  readonly name?: string;
};

export type ColumnPersistableMode = 'insert' | 'update' | 'read';

export type PropertyOptions<T> = {
  readonly column: IdColumnOptions<T>;
  readonly relation: RelationOptions<T>;
};

export type ColumnOptions<T> = {
  readonly property?: string;
  readonly name?: string;
  readonly mode?: ColumnPersistableMode;
  readonly isId?: boolean;
};
export type IdColumnOptions<T> = {
  readonly autoValue?: 'db' | 'uuid';
  readonly isId?: true;
} & ColumnOptions<T>;

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
  readonly id?: IdColumnOptions<T>;
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
    [key: string]: IdColumnOptions<T>;
  };
  /**
   * readonly shorthand for accesing 'relations' metadata
   */
  readonly relations?: {
    [key: string]: RelationOptions<T>;
  };
};
