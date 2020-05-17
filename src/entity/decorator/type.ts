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
  readonly cardinality: 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
  readonly mappedBy?: keyof T;
};

export type RelationToOneProperties<T> = Omit<RelationProperties<T>, 'cardinality'>;
export type RelationToManyProperties<T> = RelationToOneProperties<T>;
