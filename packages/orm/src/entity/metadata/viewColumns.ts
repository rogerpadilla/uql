import type {
  AbstractType,
  EntityGetter,
  EntityMeta,
  FieldOptions,
  QueryAggregateOp,
  QueryAggregate,
  ViewFind,
} from '../../type/index.js';
import { normalizeScalarFieldSelection, parseGroupMap } from '../../util/dialect.util.js';
import { aggregatedColumn, aggregateOf } from '../../util/field.util.js';
import { getKeys } from '../../util/object.util.js';
import { fieldOf, relationOf } from './lookup.js';

/**
 * Whether a view column keeps each option of the column it reads: its shape and exposure, nothing a write or the
 * schema means. Total over `FieldOptions`, so an option added there is decided here. Its key is set apart.
 */
const KEPT = {
  type: true,
  columnType: true,
  length: true,
  precision: true,
  scale: true,
  dimensions: true,
  distance: true,
  enum: true,
  schema: true,
  nullable: true,
  wire: true,
  name: false,
  isId: false,
  references: false,
  onDelete: false,
  computed: false,
  stored: false,
  updatable: false,
  eager: false,
  onInsert: false,
  onUpdate: false,
  softDelete: false,
  tenant: false,
  version: false,
  unique: false,
  defaultValue: false,
  autoIncrement: false,
  index: false,
  comment: false,
} as const satisfies Record<keyof FieldOptions, boolean>;

type ShapeKey = { [K in keyof typeof KEPT]: (typeof KEPT)[K] extends true ? K : never }[keyof typeof KEPT];

const SHAPE_KEYS = getKeys(KEPT).filter((key): key is ShapeKey => KEPT[key]);

/** A view column: its shape, and the entity whose key it holds, where it reads one. */
type Shape = Pick<FieldOptions, ShapeKey | 'references'>;

/** A view column as an aggregate states it: a group, which may key the view, or an aggregate. */
type ViewColumn = { readonly alias: string; readonly group: boolean; readonly shape: Shape };

/** What a view reads its sources through, which the registry gives: it imports this module. */
export type ViewSources = {
  /** An entity's registered meta, its relations settled so a path through them resolves. */
  readonly metaOf: (entity: AbstractType<object>) => EntityMeta<object>;
  /** The entity whose sole key a column holds: its own, or the one it references. */
  readonly keyOwnerOf: (meta: EntityMeta<object>, key: string) => EntityGetter | undefined;
};

/** A view's columns off its aggregate: each group as the column it reads, each aggregate as what it answers. */
export function aggregateColumns(
  source: EntityMeta<object>,
  query: QueryAggregate<object>,
  sources: ViewSources,
): Record<string, FieldOptions> {
  const columns = parseGroupMap(query.$group, query.$select).map((entry): ViewColumn =>
    entry.kind === 'key'
      ? { alias: entry.alias, group: true, shape: groupColumn(source, entry.path, sources) }
      : {
          alias: entry.alias,
          group: false,
          // An aggregate over no rows is `0` for a count, `NULL` for the rest.
          shape: {
            ...aggregateShape(source, entry.op, entry.field, sources),
            ...(entry.op !== '$count' && { nullable: true }),
          },
        },
  );
  const groups = columns.filter(({ group }) => group);
  // The groups are the key only where none can be NULL: NULL groups are not unique.
  const keyed = groups.length > 0 && groups.every(({ shape }) => !shape.nullable);
  return Object.fromEntries(
    columns.map(({ alias, group, shape }) => [alias, keyed && group ? { ...shape, isId: true } : shape]),
  );
}

/** A view's columns off its find: each field it selects as its source's, keyed by its source's key where it selects it. */
export function findColumns(
  source: EntityMeta<object>,
  query: ViewFind<object>,
  sources: ViewSources,
): Record<string, FieldOptions> {
  const keys = normalizeScalarFieldSelection(source, query.$select);
  const keyed = source.ids.length > 0 && source.ids.every((id) => keys.includes(id));
  return Object.fromEntries(
    keys.map((key) => {
      const column = fieldShape(source, key, sources);
      return [key, keyed && source.ids.includes(key) ? { ...column, isId: true } : column];
    }),
  );
}

/** A group's column: the field at the end of its path, through the to-ones a group joins as required. */
function groupColumn(source: EntityMeta<object>, path: readonly string[], sources: ViewSources): Shape {
  let meta = source;
  for (const key of path.slice(0, -1)) {
    meta = sources.metaOf(relationOf(meta, key).entity());
  }
  return fieldShape(meta, path.at(-1)!, sources);
}

/** A field's shape, holding the key it holds; a relation aggregate's is what it answers. */
function fieldShape(meta: EntityMeta<object>, key: string, sources: ViewSources): Shape {
  const field = fieldOf(meta, key);
  const spec = aggregateOf(field);
  if (spec) {
    const target = sources.metaOf(relationOf(meta, spec.relation).entity());
    return { ...aggregateShape(target, spec.op, spec.field, sources), ...(field.nullable && { nullable: true }) };
  }
  const owner = sources.keyOwnerOf(meta, key);
  return { ...pickShape(field), ...(owner && { references: owner }) };
}

/**
 * What an aggregate over `meta`'s `key` answers, as {@link aggregatedColumn} says, less its nullability, which its
 * caller decides. Only a `$min` or a `$max` is one of the values it read, so only it holds the key that column does.
 */
function aggregateShape(
  meta: EntityMeta<object>,
  op: QueryAggregateOp,
  key: string | undefined,
  sources: ViewSources,
): Shape {
  const column = aggregatedColumn(op, key);
  if (column === undefined) {
    return { type: Number };
  }
  const { nullable: _, references, ...shape } = fieldShape(meta, column, sources);
  return references && (op === '$min' || op === '$max') ? { ...shape, references } : shape;
}

function pickShape(field: FieldOptions): Shape {
  const shape: Shape = {};
  for (const key of SHAPE_KEYS) {
    if (field[key] !== undefined) {
      Object.assign(shape, { [key]: field[key] });
    }
  }
  return shape;
}
