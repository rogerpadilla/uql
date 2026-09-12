/** The direction, or `'text'`, of one field in a MongoDB index key spec. */
export type MongoIndexKey = Record<string, 1 | -1 | 'text'>;

/**
 * `SchemaGenerator` yields one string per statement, so {@link MongoSchemaGenerator} emits its
 * commands as JSON and this is their schema.
 *
 * Declared next to the generator that writes them because the migrator used to restate the shape
 * inline from `JSON.parse`, with `cmd.name!` assertions and a bare `action: string` - where a command
 * it had no branch for (`renameCollection`) was silently a no-op.
 */
export type MongoCommand =
  | { readonly action: 'createCollection'; readonly name: string }
  | { readonly action: 'dropCollection'; readonly name: string }
  | { readonly action: 'renameCollection'; readonly from: string; readonly to: string }
  | {
      readonly action: 'createIndex';
      readonly collection: string;
      readonly name: string;
      readonly key: MongoIndexKey;
      readonly options: { readonly unique: boolean; readonly name: string };
    }
  | { readonly action: 'dropIndex'; readonly collection: string; readonly name: string };

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
    createIndex(key: MongoIndexKey, options: { unique: boolean; name: string }): Promise<unknown>;
    dropIndex(name: string): Promise<unknown>;
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
    default:
      // Unreachable for a command this module produced; a hand-written statement lands here rather
      // than being silently skipped, which is how `renameCollection` went unnoticed.
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
    default:
      throw unsupportedMongoCommand(statement);
  }
}
