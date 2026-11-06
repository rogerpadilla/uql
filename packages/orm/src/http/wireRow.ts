import { EQUALITY_OPS, isGroupOp, isOrderedOp } from '../dialect/operators.js';
import { getMeta, relationOf, valueFieldOf } from '../entity/metadata/definition.js';
import type { EntityMeta, FieldMeta, RelationKey } from '../type/index.js';
import { decodeDate } from '../util/date.js';
import { aggregateOf, columnFamily } from '../util/field.util.js';
import { cachedIn, definedEntries, isPlainObject } from '../util/object.util.js';
import type { WireAnswer } from './contract.js';

type Convert = (value: unknown) => unknown;

/** How one way across JSON treats an entity's rows: each field it converts, and each relation it reads into. */
type Plan = {
  readonly fields: ReadonlyMap<string, Convert>;
  readonly relations: ReadonlyMap<string, EntityMeta<object>>;
};

/** How a field converts one way, `undefined` where JSON carries it as it is. */
type FieldConvert = (field: FieldMeta) => Convert | undefined;

/** What JSON cannot hold as the server holds it: a `bigint`, sent as its digits. */
const sent: FieldConvert = (field) => (valueFieldOf(field).type === BigInt ? String : undefined);

/**
 * What JSON carried as text: a `bigint`'s digits, and a date's ISO text. A time of day stays the text it is, and so
 * does text no `bigint` spells, for the engine to refuse as it refuses any malformed value.
 */
const received: FieldConvert = (field) => {
  const { type } = valueFieldOf(field);
  if (type === BigInt) {
    return (text) => {
      try {
        return BigInt(String(text));
      } catch {
        return text;
      }
    };
  }
  return columnFamily(type) === 'date' ? (text) => decodeDate(String(text)) : undefined;
};

/** `data` as JSON is to carry it, by what its route `answers`; the client reads it back by {@link readWireData}. */
export function writeWireData<E>(meta: EntityMeta<E>, data: unknown, answers: WireAnswer): unknown {
  return across(meta, data, answers, SENDING);
}

/** `data` JSON carried, a response or a write's body, read back as the entity holds it by what it `answers`. */
export function readWireData<E>(meta: EntityMeta<E>, data: unknown, answers: WireAnswer): unknown {
  return across(meta, data, answers, RECEIVING);
}

/**
 * `query` with each value it compares a field with read back as the entity holds it, its `$populate` and `$count`
 * relations' included: JSON carried each date and `bigint` as text, which an engine would compare as text.
 */
export function readWireQuery<E, Q extends RelationClauses>(meta: EntityMeta<E>, query: Q): Q {
  const plan = planIn(RECEIVING, meta);
  const related = (clause: object) =>
    Object.fromEntries(
      Object.entries(clause).map(([key, nested]) => {
        const target = plan.relations.get(key);
        return [key, target && isPlainObject(nested) ? readWireQuery(target, nested) : nested];
      }),
    );
  return {
    ...query,
    ...(query.$where !== undefined && { $where: whereOf(meta, query.$where) }),
    ...(query.$populate !== undefined && { $populate: related(query.$populate) }),
    ...(query.$count !== undefined && { $count: related(query.$count) }),
  };
}

/** The clauses of a query that compare or reach a relation's rows. */
type RelationClauses = { readonly $where?: unknown; readonly $populate?: object; readonly $count?: object };

/** One way across JSON: how a field converts, and each entity's plan, worked out once. */
type Way = { readonly field: FieldConvert; readonly plans: WeakMap<object, Plan> };

const SENDING: Way = { field: sent, plans: new WeakMap() };
const RECEIVING: Way = { field: received, plans: new WeakMap() };

function planIn<E>(way: Way, meta: EntityMeta<E>): Plan {
  return cachedIn(way.plans, meta, () => planOf(meta, way.field));
}

function across<E>(meta: EntityMeta<E>, data: unknown, answers: WireAnswer, way: Way): unknown {
  switch (answers) {
    case 'count':
      return data;
    case 'rows':
      return convert(meta, data, way);
    case 'page': {
      if (!isPlainObject(data)) {
        return data;
      }
      const items = convert(meta, data['items'], way);
      return items === data['items'] ? data : { ...data, items };
    }
    case 'ids': {
      const [idKey] = meta.ids;
      const sole = meta.ids.length === 1 ? planIn(way, meta).fields.get(idKey) : undefined;
      // A composite key is a row of its columns; a sole one its value.
      const id = (key: unknown) =>
        isPlainObject(key) ? convert(meta, key, way) : sole && key != null ? sole(key) : key;
      return Array.isArray(data) ? data.map(id) : id(data);
    }
  }
}

function convert<E>(meta: EntityMeta<E>, rows: unknown, way: Way): unknown {
  if (Array.isArray(rows)) {
    const converted = rows.map((row) => convert(meta, row, way));
    return converted.every((row, index) => row === rows[index]) ? rows : converted;
  }
  if (!isPlainObject(rows)) {
    return rows;
  }
  const plan = planIn(way, meta);
  let row: Record<string, unknown> | undefined;
  for (const [key, to] of plan.fields) {
    const value = rows[key];
    if (value != null) {
      row ??= { ...rows };
      // An update's operator, `{ $inc: 1 }`, holds the values it applies.
      row[key] = isPlainObject(value)
        ? Object.fromEntries(Object.entries(value).map(([op, operand]) => [op, to(operand)]))
        : to(value);
    }
  }
  for (const [key, target] of plan.relations) {
    const read = convert(target, rows[key], way);
    if (read !== rows[key]) {
      row ??= { ...rows };
      row[key] = read;
    }
  }
  return row ?? rows;
}

function planOf<E>(meta: EntityMeta<E>, convertField: FieldConvert): Plan {
  return {
    fields: new Map(
      definedEntries(meta.fields).flatMap(([key, field]): [string, Convert][] => {
        const source = readField(meta, field);
        const to = source && convertField(source);
        return to ? [[key, to]] : [];
      }),
    ),
    relations: new Map(definedEntries(meta.relations).map(([key, relation]) => [key, getMeta(relation.entity())])),
  };
}

/** A `$where` of `meta` with each value a field is compared with read back, through groups and relations. */
function whereOf<E>(meta: EntityMeta<E>, where: unknown): unknown {
  if (Array.isArray(where)) {
    return where.map((clause) => whereOf(meta, clause));
  }
  if (!isPlainObject(where)) {
    return where;
  }
  const plan = planIn(RECEIVING, meta);
  return Object.fromEntries(
    Object.entries(where).map(([key, value]) => {
      const to = plan.fields.get(key);
      if (to) {
        return [key, compared(value, to)];
      }
      const target = plan.relations.get(key);
      return [key, target ? whereOf(target, value) : isGroupOp(key) ? whereOf(meta, value) : value];
    }),
  );
}

/** A field's condition with each value it compares with read by `to`: a pattern or a null check stays as it is. */
function compared(condition: unknown, to: Convert): unknown {
  if (Array.isArray(condition)) {
    return condition.map(to);
  }
  if (!isPlainObject(condition)) {
    return condition == null ? condition : to(condition);
  }
  return Object.fromEntries(
    Object.entries(condition).map(([op, value]) => [
      op,
      op === '$not' || EQUALITY_OPS.has(op) || isOrderedOp(op) ? compared(value, to) : value,
    ]),
  );
}

/** The field a field's value reads as: a relation aggregate's, none for a tally or a mean, which read as numbers. */
function readField<E>(meta: EntityMeta<E>, field: FieldMeta): FieldMeta | undefined {
  const spec = aggregateOf(field);
  if (!spec) {
    return field;
  }
  return spec.field && spec.op !== '$avg'
    ? getMeta(relationOf(meta, spec.relation as RelationKey<E>).entity()).fields[spec.field]
    : undefined;
}
