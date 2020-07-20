export type EntityOptions = {
  readonly name?: string;
};

export type ColumnPersistableMode = 'insert' | 'update' | 'read';

export type PropetyOptions<T> = {
  readonly column: ColumnOptions<T>;
  readonly relation: RelationOptions<T>;
};
export type ColumnOptions<T> = {
  readonly name?: string;
  readonly mode?: ColumnPersistableMode;
};
export type PrimaryColumnOptions<T> = ColumnOptions<T>;

export type RelationOptions<T> = {
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
  id?: string;
  isEntity?: boolean;
  /**
   * 'properties' contains both, columns and relations metadata
   */
  properties: {
    [prop: string]: PropetyOptions<T>;
  };
  /**
   * readonly shorthand for accesing 'columns' metadata
   */
  readonly columns?: {
    [prop: string]: ColumnOptions<T>;
  };
  /**
   * readonly shorthand for accesing 'relations' metadata
   */
  readonly relations?: {
    [prop: string]: RelationOptions<T>;
  };
};
