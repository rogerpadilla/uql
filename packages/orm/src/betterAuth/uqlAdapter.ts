import type { BetterAuthOptions } from 'better-auth';
import {
  type AdapterFactoryCustomizeAdapterCreator,
  type CleanedWhere,
  createAdapterFactory,
  type CustomAdapter,
  type DBAdapter,
  type DBAdapterDebugLogOption,
  type WhereOperator,
} from 'better-auth/adapters';
import { likeLiteral } from '../dialect/operators.js';
import { getMeta, idOf } from '../entity/index.js';
import type { QuerierPool, Type, UniversalQuerier } from '../type/index.js';
import { whereIds } from '../util/dialect.util.js';
import { entityName } from '../util/object.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { authEntities } from './authEntities.js';

export type UqlAdapterOptions = {
  readonly debugLogs?: DBAdapterDebugLogOption;
  /**
   * Whether Better Auth runs its multi-step writes in one transaction: on wherever the engine has them,
   * so off on D1. A standalone MongoDB, which has them only as a replica set, needs `false`.
   */
  readonly transaction?: boolean;
};

/**
 * Better Auth on a UQL pool, on every engine UQL runs on: `betterAuth({ database: uqlAdapter(pool) })`.
 * Its tables are the entities {@link authEntities} returns, which `uql-migrate` creates like any other.
 */
export function uqlAdapter(
  pool: QuerierPool,
  opts: UqlAdapterOptions = {},
): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  const transactions = opts.transaction ?? pool.dialect.features.transactions;
  return (options) => {
    const entities = Object.fromEntries(authEntities(options).map((entity) => [entityName(getMeta(entity)), entity]));
    const on = (querier: UniversalQuerier, inTransaction: boolean): DBAdapter<BetterAuthOptions> =>
      createAdapterFactory({
        config: {
          adapterId: 'uql',
          adapterName: 'UQL',
          debugLogs: opts.debugLogs,
          supportsJSON: true,
          supportsDates: true,
          supportsBooleans: true,
          supportsNumericIds: true,
          supportsArrays: true,
          // The same adapter over the transaction's querier, as Better Auth's own adapters rebuild theirs.
          transaction:
            transactions && !inTransaction ? (callback) => pool.transaction((trx) => callback(on(trx, true))) : false,
        },
        adapter: ({ getFieldName }) => methodsOf(querier, entities, getFieldName),
      })(options);
    return on(pool, false);
  };
}

type FieldNameOf = Parameters<AdapterFactoryCustomizeAdapterCreator>[0]['getFieldName'];

/**
 * Better Auth's database methods over `querier`, its tables by the names its factory checked each `model`
 * against. Only `where` arrives in database names; the rest are mapped here.
 */
function methodsOf(
  querier: UniversalQuerier,
  entities: Readonly<Record<string, Type<object>>>,
  getFieldName: FieldNameOf,
): CustomAdapter {
  const select = (model: string, fields: readonly string[] | undefined) =>
    fields?.length ? Object.fromEntries(fields.map((field) => [getFieldName({ model, field }), true])) : undefined;
  const filter = (where: readonly CleanedWhere[]) => ({ $where: whereOf(where) });

  /**
   * Writes `payload` to the first row `where` finds, pinned to that row while it still matches `where`,
   * and reads it back: `null` where none matched, or a concurrent write moved the row past the guard first.
   */
  const updateOne = async <T>(model: string, where: readonly CleanedWhere[], payload: object) => {
    const entity = entities[model];
    const row = await querier.findOne(entity, filter(where));
    if (!row) {
      return null;
    }
    const meta = getMeta(entity);
    const id = idOf(meta, row);
    const pinned = { $where: { $and: [whereOf(where), whereIds(meta, id)] } };
    const changed = await querier.updateMany(entity, pinned, payload);
    return changed ? asRow<T | null>(await querier.findOneById(entity, id)) : null;
  };

  return {
    async create<T extends Record<string, unknown>>({ model, data }: { model: string; data: T }) {
      const entity = entities[model];
      const id = await querier.insertOne(entity, data);
      // The row as stored, which Better Auth's SQL adapters return too: a column left out reads its default.
      const row = id === undefined ? undefined : await querier.findOneById(entity, id);
      if (!row) {
        throw new UqlUsageError(`Better Auth inserted a '${model}' row it cannot read back: does a filter hide it?`);
      }
      return asRow<T>(row);
    },
    async findOne<T>({ model, modelKey = model, where, select: fields }: FindOne) {
      return asRow<T | null>(
        await querier.findOne(entities[model], { ...filter(where), $select: select(modelKey, fields) }),
      );
    },
    async findMany<T>({ model, modelKey = model, where = [], select: fields, sortBy, offset, limit }: FindMany) {
      const rows = await querier.findMany(entities[model], {
        ...filter(where),
        $select: select(modelKey, fields),
        $sort: sortBy && { [getFieldName({ model: modelKey, field: sortBy.field })]: sortBy.direction },
        $skip: offset,
        $limit: limit,
      });
      return rows.map((row) => asRow<T>(row));
    },
    count({ model, where = [] }) {
      return querier.count(entities[model], filter(where));
    },
    update<T>({ model, where, update }: { model: string; where: CleanedWhere[]; update: T }) {
      return updateOne<T>(model, where, payloadOf(update));
    },
    // `$inc` adds in the statement, so racing increments all land, where a read-then-write would retry.
    incrementOne<T>({ model, where, increment, set }: IncrementOne) {
      const steps = Object.fromEntries(Object.entries(increment).map(([field, $inc]) => [field, { $inc }]));
      return updateOne<T>(model, where, { ...set, ...steps });
    },
    updateMany({ model, where, update }) {
      return querier.updateMany(entities[model], filter(where), update, { unfiltered: !where.length });
    },
    async delete({ model, where }) {
      // Unlike `deleteMany`, never unfiltered: UQL refuses one naming no row.
      await querier.deleteMany(entities[model], filter(where));
    },
    deleteMany({ model, where }) {
      return querier.deleteMany(entities[model], filter(where), { unfiltered: !where.length });
    },
  };
}

type FindOne = Parameters<CustomAdapter['findOne']>[0];
type FindMany = Parameters<CustomAdapter['findMany']>[0];
type IncrementOne = Parameters<NonNullable<CustomAdapter['incrementOne']>>[0];

/**
 * A row as the type Better Auth asks for, `null` for none: each method lets its caller name the shape of
 * its own table, which no query can check, so this is the one place UQL takes that on trust.
 */
function asRow<T>(row: object | undefined): T {
  return (row ?? null) as T;
}

/** An update's payload, which Better Auth types as anything and always sends as a row of fields. */
function payloadOf(update: unknown): object {
  if (typeof update !== 'object' || update === null) {
    throw new UqlUsageError('Better Auth sent an update that is not a row of fields');
  }
  return update;
}

/** A query Better Auth builds: its field names are data it hands over at run time. */
type AuthWhere = Record<string, unknown>;

/**
 * Better Auth's clauses as one `$where`: all of those joined by `AND`, and any of those joined by `OR`.
 * Each clause is an entry of its own, since two on one field would overwrite each other in one map.
 */
function whereOf(where: readonly CleanedWhere[]): AuthWhere {
  const all = where.filter((clause) => clause.connector === 'AND').map(clauseOf);
  const any = where.filter((clause) => clause.connector === 'OR').map(clauseOf);
  const $where: AuthWhere = {};
  if (all.length) $where['$and'] = all;
  if (any.length) $where['$or'] = any;
  return $where;
}

/** One clause; ignoring case applies where every value is text, as Better Auth's own adapters hold. */
function clauseOf({ field, operator, value, mode }: CleanedWhere): AuthWhere {
  const values = [value].flat();
  const texts =
    mode === 'insensitive' && values.length && values.every((it) => typeof it === 'string') ? values : undefined;
  return CLAUSES[operator](field, value, texts);
}

type Clause = (field: string, value: CleanedWhere['value'], texts: readonly string[] | undefined) => AuthWhere;

/** A literal case-insensitive match, which reads the same on every engine. */
const ilike = (field: string, text: string): AuthWhere => ({ [field]: { $ilike: likeLiteral(text) } });

/** An `in` list without `null`, which no `IN` matches and which makes every `NOT IN` match nothing. */
const listOf = (value: CleanedWhere['value']) => [value].flat().filter((it) => it !== null);

/** Every Better Auth operator as the clause it is; `satisfies` fails the build on one it adds. */
const CLAUSES = {
  eq: (field, value, texts) => (texts ? ilike(field, texts[0]) : { [field]: { $eq: value } }),
  ne: (field, value, texts) => (texts ? { $not: [ilike(field, texts[0])] } : { [field]: { $ne: value } }),
  lt: (field, value) => ({ [field]: { $lt: value } }),
  lte: (field, value) => ({ [field]: { $lte: value } }),
  gt: (field, value) => ({ [field]: { $gt: value } }),
  gte: (field, value) => ({ [field]: { $gte: value } }),
  in: (field, value, texts) =>
    texts ? { $or: texts.map((text) => ilike(field, text)) } : { [field]: { $in: listOf(value) } },
  not_in: (field, value, texts) =>
    texts ? { $nor: texts.map((text) => ilike(field, text)) } : { [field]: { $nin: listOf(value) } },
  contains: (field, value, texts) => ({ [field]: { [texts ? '$iincludes' : '$includes']: value } }),
  starts_with: (field, value, texts) => ({ [field]: { [texts ? '$istartsWith' : '$startsWith']: value } }),
  ends_with: (field, value, texts) => ({ [field]: { [texts ? '$iendsWith' : '$endsWith']: value } }),
} as const satisfies Record<WhereOperator, Clause>;
