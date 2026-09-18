/** The direction, or `'text'`, of one field in a MongoDB index key spec. */
export type MongoIndexKey = Record<string, 1 | -1 | 'text'>;

/** What a `createIndex` command hands the driver beside its key spec. */
export type MongoIndexOptions = {
  readonly unique: boolean;
  readonly name: string;
  readonly partialFilterExpression?: Readonly<Record<string, unknown>>;
  /** A text index's weight per field, which `textScore` multiplies a match in it by. */
  readonly weights?: Readonly<Record<string, number>>;
  /** The language a text index stems and drops stop words in, a search's own `$language` aside. */
  readonly default_language?: string;
};

/** A field of an Atlas vector search index: the vector itself, or one its `filter` pre-filters on. */
export type MongoVectorSearchField =
  | { readonly type: 'vector'; readonly path: string; readonly numDimensions: number; readonly similarity: string }
  | { readonly type: 'filter'; readonly path: string };

/** An Atlas search index as `createSearchIndex` takes one. */
export type MongoSearchIndex = {
  readonly name: string;
  readonly type: 'vectorSearch';
  readonly definition: { readonly fields: readonly MongoVectorSearchField[] };
};

/** The commands {@link MongoSchemaGenerator} emits as JSON, one per statement. */
export type MongoCommand =
  | { readonly action: 'createCollection'; readonly name: string }
  | { readonly action: 'dropCollection'; readonly name: string }
  | { readonly action: 'renameCollection'; readonly from: string; readonly to: string }
  | {
      readonly action: 'createIndex';
      readonly collection: string;
      readonly name: string;
      readonly key: MongoIndexKey;
      readonly options: MongoIndexOptions;
    }
  | { readonly action: 'dropIndex'; readonly collection: string; readonly name: string }
  | { readonly action: 'createSearchIndex'; readonly collection: string; readonly index: MongoSearchIndex }
  | { readonly action: 'dropSearchIndex'; readonly collection: string; readonly name: string };

export function serializeMongoCommand(command: MongoCommand): string {
  return JSON.stringify(command);
}

/**
 * What executing these commands needs of a database handle. Declared structurally rather than as the
 * driver's `Db` so this module carries no dependency on the optional `mongodb` peer, and so a test can
 * satisfy it with a plain object.
 */
export type MongoCommandTarget = {
  createCollection(name: string): Promise<unknown>;
  renameCollection(from: string, to: string): Promise<unknown>;
  collection(name: string): {
    drop(): Promise<unknown>;
    createIndex(key: MongoIndexKey, options: MongoIndexOptions): Promise<unknown>;
    dropIndex(name: string): Promise<unknown>;
    createSearchIndex(index: MongoSearchIndex): Promise<unknown>;
    dropSearchIndex(name: string): Promise<unknown>;
  };
};

/**
 * Read one emitted command back. The single cast lives here, where the union it casts to is defined
 * alongside the only code that writes these strings.
 */
function parseMongoCommand(statement: string): MongoCommand {
  return JSON.parse(statement) as MongoCommand;
}

function unsupportedMongoCommand(statement: string): TypeError {
  return new TypeError(`unsupported MongoDB migration command: ${statement}`);
}

/** Execute one emitted command. */
export function runMongoCommand(db: MongoCommandTarget, statement: string): Promise<unknown> {
  const command = parseMongoCommand(statement);
  switch (command.action) {
    case 'createCollection':
      return db.createCollection(command.name);
    case 'dropCollection':
      return db.collection(command.name).drop();
    case 'renameCollection':
      return db.renameCollection(command.from, command.to);
    case 'createIndex':
      return db.collection(command.collection).createIndex(command.key, command.options);
    case 'dropIndex':
      return db.collection(command.collection).dropIndex(command.name);
    case 'createSearchIndex':
      return db.collection(command.collection).createSearchIndex(command.index);
    case 'dropSearchIndex':
      return db.collection(command.collection).dropSearchIndex(command.name);
    default:
      // Unreachable for a command this module produced; a hand-written statement lands here rather
      // than being silently skipped.
      throw unsupportedMongoCommand(statement);
  }
}

/** The driver call {@link runMongoCommand} makes, as source on the handle `db` names, for a generated migration. */
export function mongoCommandSource(statement: string, db: string): string {
  const command = parseMongoCommand(statement);
  const literal = JSON.stringify;
  switch (command.action) {
    case 'createCollection':
      return `${db}.createCollection(${literal(command.name)})`;
    case 'dropCollection':
      return `${db}.collection(${literal(command.name)}).drop()`;
    case 'renameCollection':
      return `${db}.renameCollection(${literal(command.from)}, ${literal(command.to)})`;
    case 'createIndex':
      return `${db}.collection(${literal(command.collection)}).createIndex(${literal(command.key)}, ${literal(command.options)})`;
    case 'dropIndex':
      return `${db}.collection(${literal(command.collection)}).dropIndex(${literal(command.name)})`;
    case 'createSearchIndex':
      return `${db}.collection(${literal(command.collection)}).createSearchIndex(${literal(command.index)})`;
    case 'dropSearchIndex':
      return `${db}.collection(${literal(command.collection)}).dropSearchIndex(${literal(command.name)})`;
    default:
      throw unsupportedMongoCommand(statement);
  }
}
