export type EntityProperties = {
  readonly name?: string;
};

export type ColumnPersistableMode = 'insert' | 'update' | 'read';

export type ColumnProperties = {
  readonly name?: string;
  readonly mode?: ColumnPersistableMode;
  readonly relation?: RelationProperties<any>;
};

export type PrimaryColumnProperties = Omit<ColumnProperties, 'mode'>;

export type RelationProperties<T> = {
  type?: () => { new (): T };
  readonly cardinality: RelationCardinality;
  mappedBy?: keyof T;
};

export type RelationCardinality = 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
export type RelationOneToOneProperties<T> = { type?: () => { new (): T }; mappedBy: keyof T };
export type RelationOneToManyProperties<T> = { type: () => { new (): T }; mappedBy: keyof T };
export type RelationManyToOneProperties<T> = { type?: () => { new (): T } };
export type RelationManyToManyProperties<T> = { type: () => { new (): T } };

export type EntityMeta<T> = {
  readonly type: { new (): T };
  name: string;
  id?: string;
  columns: {
    [prop: string]: ColumnProperties;
  };
  isEntity?: boolean;
};
