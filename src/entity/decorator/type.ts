export type ColumnPersistableMode = 'insert' | 'update' | 'read';

export type ColumnProperties = {
  mode?: ColumnPersistableMode;
};

export type PrimaryColumnProperties = Omit<ColumnProperties, 'mode'>;

export type RelationProperties = {
  type?: () => { new (): any };
  readonly cardinality: 'oneToOne' | 'manyToOne';
};
