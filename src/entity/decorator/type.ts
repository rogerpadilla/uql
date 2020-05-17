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
  readonly mappedBy?: keyof T;
};

export type RelationCardinality = 'oneToOne' | 'manyToOne' | 'oneToMany' | 'manyToMany';
export type RelationOneToManyProperties<T> = Required<Omit<RelationProperties<T>, 'cardinality'>>;
export type RelationOneToOneProperties<T> = Required<Omit<RelationProperties<T>, 'cardinality'>>;
export type RelationManyToOneProperties<T> = Omit<RelationProperties<T>, 'cardinality' | 'mappedBy'>;
export type RelationManyToManyProperties<T> = Omit<RelationProperties<T>, 'cardinality'>;
