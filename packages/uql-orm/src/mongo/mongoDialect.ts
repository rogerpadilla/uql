import { type Document, type Filter, ObjectId, type Sort } from 'mongodb';
import { AbstractDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type { IndexType } from '../schema/types.js';
import type {
  EntityMeta,
  FieldValue,
  NamingStrategy,
  Query,
  QueryAggregate,
  QueryOptions,
  QuerySelect,
  QuerySortMap,
  QueryVectorSearch,
  QueryWhere,
  RelationKey,
  Type,
} from '../type/index.js';
import {
  buildQueryWhereAsMap,
  buildSortMap,
  type CallbackKey,
  fillOnFields,
  filterFieldKeys,
  filterRelationKeys,
  getKeys,
  hasKeys,
  isVectorSearch,
  parseGroupMap,
} from '../util/index.js';

export class MongoDialect extends AbstractDialect {
  private static readonly ID_KEY = '_id';
  private static readonly VECTOR_INDEX_TYPES = new Set<IndexType>(['vectorSearch', 'hnsw', 'ivfflat', 'vector']);

  private static readonly AGGREGATE_OP_MAP: Record<string, string> = {
    $count: '$sum',
    $sum: '$sum',
    $avg: '$avg',
    $min: '$min',
    $max: '$max',
  };

  constructor(namingStrategy?: NamingStrategy) {
    super('mongodb', namingStrategy);
  }

  public where<E extends Document>(
    entity: Type<E>,
    where: QueryWhere<E> = {},
    { softDelete }: QueryOptions = {},
  ): Filter<E> {
    const meta = getMeta(entity);
    const whereMap = buildQueryWhereAsMap(meta, where);

    if (meta.softDelete && (softDelete || softDelete === undefined) && !whereMap[meta.softDelete]) {
      const field = meta.fields[meta.softDelete];
      (whereMap as Record<string, unknown>)[this.resolveColumnName(meta.softDelete, field!)] = null;
    }

    const filter: Record<string, unknown> = {};
    for (const [rawKey, rawVal] of Object.entries(whereMap)) {
      let key = rawKey;
      let val: unknown = rawVal;
      if (key === '$and' || key === '$or') {
        filter[key] = (val as QueryWhere<E>[]).map((filterIt) => this.where(entity, filterIt));
      } else {
        const field = meta.fields[key];
        if (key === MongoDialect.ID_KEY || key === meta.id) {
          key = MongoDialect.ID_KEY;
          val = this.getIdValue(val as IdValue);
        } else if (field) {
          key = this.resolveColumnName(key, field);
        }
        if (
          val &&
          typeof val === 'object' &&
          !Array.isArray(val) &&
          this.hasOperatorKeys(val as Record<string, unknown>)
        ) {
          val = this.transformOperators(val as Record<string, unknown>);
        } else if (Array.isArray(val)) {
          val = { $in: val };
        }
        filter[key] = val;
      }
    }
    return filter as Filter<E>;
  }

  /**
   * Check if an object has operator keys (keys starting with $).
   */
  private hasOperatorKeys(obj: Record<string, unknown>): boolean {
    return Object.keys(obj).some((key) => key.startsWith('$'));
  }

  protected mapTableNameRow(row: { table_name: string }): string {
    return row.table_name;
  }

  /** String operators → { pattern: (v) => regex, caseInsensitive } */
  private static readonly REGEX_OP_MAP: Record<string, { wrap: (v: unknown) => string; ci: boolean }> = {
    $startsWith: { wrap: (v) => `^${v}`, ci: false },
    $istartsWith: { wrap: (v) => `^${v}`, ci: true },
    $endsWith: { wrap: (v) => `${v}$`, ci: false },
    $iendsWith: { wrap: (v) => `${v}$`, ci: true },
    $includes: { wrap: (v) => String(v), ci: false },
    $iincludes: { wrap: (v) => String(v), ci: true },
    $like: { wrap: (v) => String(v).replace(/%/g, '.*').replace(/_/g, '.'), ci: false },
    $ilike: { wrap: (v) => String(v).replace(/%/g, '.*').replace(/_/g, '.'), ci: true },
  };

  /** MongoDB native operators — pass through as-is. */
  private static readonly NATIVE_OPS = new Set([
    '$all',
    '$size',
    '$elemMatch',
    '$eq',
    '$ne',
    '$lt',
    '$lte',
    '$gt',
    '$gte',
    '$in',
    '$nin',
    '$regex',
    '$not',
  ]);

  /**
   * Transform UQL operators to MongoDB operators.
   */
  private transformOperators(ops: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [op, val] of Object.entries(ops)) {
      // Native MongoDB operators — pass through directly
      if (MongoDialect.NATIVE_OPS.has(op)) {
        result[op] = val;
        continue;
      }
      // String/pattern → regex operators (8 variants including $like/$ilike)
      const regexEntry = MongoDialect.REGEX_OP_MAP[op];
      if (regexEntry) {
        result['$regex'] = regexEntry.wrap(val);
        if (regexEntry.ci) result['$options'] = 'i';
        continue;
      }
      // Structural transforms
      switch (op) {
        case '$between': {
          const [min, max] = val as [unknown, unknown];
          result['$gte'] = min;
          result['$lte'] = max;
          break;
        }
        case '$isNull':
          result[val ? '$eq' : '$ne'] = null;
          break;
        case '$isNotNull':
          result[val ? '$ne' : '$eq'] = null;
          break;
        case '$text':
          result['$text'] = { $search: val };
          break;
        default:
          result[op] = val;
          break;
      }
    }
    return result;
  }

  public select<E extends Document>(entity: Type<E>, select: QuerySelect<E>): QuerySelect<E> {
    return select;
  }

  public sort<E extends Document>(entity: Type<E>, sort: QuerySortMap<E>): Sort {
    const raw = buildSortMap(sort);
    const normalized: Record<string, 1 | -1> = {};
    for (const [key, dir] of Object.entries(raw)) {
      normalized[key] = dir === 'desc' || dir === -1 ? -1 : 1;
    }
    return normalized as Sort;
  }

  public aggregationPipeline<E extends Document>(entity: Type<E>, q: Query<E>): MongoAggregationPipelineEntry<E>[] {
    const meta = getMeta(entity);
    const where = this.where(entity, q.$where);
    const sort = this.sort(entity, q.$sort!);
    const firstPipelineEntry: MongoAggregationPipelineEntry<E> = {};

    if (hasKeys(where)) {
      firstPipelineEntry.$match = where;
    }
    if (hasKeys(sort)) {
      firstPipelineEntry.$sort = sort;
    }

    const pipeline: MongoAggregationPipelineEntry<E>[] = [];

    if (hasKeys(firstPipelineEntry)) {
      pipeline.push(firstPipelineEntry);
    }

    const relKeys = filterRelationKeys(meta, q.$select!);

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' should be resolved in a higher layer because they will need multiple queries
        continue;
      }

      const relEntity = relOpts.entity!();
      const relMeta = getMeta(relEntity);

      if (relOpts.cardinality === 'm1') {
        const localField = meta.fields[relOpts.references![0].local];
        pipeline.push({
          $lookup: {
            from: this.resolveTableName(relEntity, relMeta),
            localField: this.resolveColumnName(relOpts.references![0].local, localField!),
            foreignField: '_id',
            as: relKey,
          },
        });
      } else {
        const foreignField = relMeta.fields[relOpts.references![0].foreign];
        const foreignFieldName = this.resolveColumnName(relOpts.references![0].foreign, foreignField!);
        const referenceWhere = this.where(relEntity, where);
        const referenceSort = this.sort(relEntity, q.$sort!);
        const _id = MongoDialect.ID_KEY;
        const referencePipelineEntry: MongoAggregationPipelineEntry<FieldValue<E>> = {
          $match: { [foreignFieldName]: referenceWhere[_id] },
        };
        if (hasKeys(referenceSort)) {
          referencePipelineEntry.$sort = referenceSort;
        }
        pipeline.push({
          $lookup: {
            from: this.resolveTableName(relEntity, relMeta),
            pipeline: [referencePipelineEntry],
            as: relKey,
          },
        });
      }

      pipeline.push({ $unwind: { path: `$${relKey}`, preserveNullAndEmptyArrays: true } });
    }

    return pipeline;
  }

  public normalizeIds<E extends Document>(meta: EntityMeta<E>, docs: E[] | undefined): E[] | undefined {
    return docs?.map((doc) => this.normalizeId(meta, doc)) as E[] | undefined;
  }

  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: E | undefined): E | undefined {
    if (!doc) {
      return doc;
    }

    const res = doc as unknown as Record<string, unknown>;
    const _id = MongoDialect.ID_KEY;

    if (res[_id]) {
      res[meta.id as string] = res[_id];
      if (meta.id !== _id) {
        delete res[_id];
      }
    }

    for (const key of getKeys(meta.fields)) {
      const field = meta.fields[key];
      const dbName = this.resolveColumnName(key, field!);
      if (dbName !== key && res[dbName] !== undefined) {
        res[key] = res[dbName];
        delete res[dbName];
      }
    }

    const relKeys = getKeys(meta.relations).filter((key) => res[key]) as RelationKey<E>[];

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relMeta = getMeta(relOpts.entity!());
      res[relKey] = Array.isArray(res[relKey])
        ? this.normalizeIds(relMeta, res[relKey] as Document[])
        : this.normalizeId(relMeta, res[relKey] as Document);
    }

    return res as unknown as E;
  }

  public getIdValue<T extends IdValue>(value: T): T {
    if (value instanceof ObjectId) {
      return value;
    }
    try {
      return new ObjectId(value) as T;
    } catch (e) {
      return value;
    }
  }

  public getPersistable<E extends Document>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): Partial<E> {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  public getPersistables<E extends Document>(
    meta: EntityMeta<E>,
    payload: E | E[],
    callbackKey: CallbackKey,
  ): Partial<E>[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    const persistableKeys = filterFieldKeys(meta, payloads[0], callbackKey);
    return payloads.map((it) =>
      persistableKeys.reduce<Partial<E>>(
        (acc, key) => {
          const field = meta.fields[key];
          (acc as Record<string, unknown>)[this.resolveColumnName(key, field!)] = it[key];
          return acc;
        },
        {} as Partial<E>,
      ),
    );
  }

  /**
   * Build MongoDB aggregation pipeline stages from a QueryAggregate.
   */
  public buildAggregateStages<E extends Document>(entity: Type<E>, q: QueryAggregate<E>): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];

    // $match stage (WHERE equivalent — before grouping)
    if (q.$where) {
      const filter = this.where(entity, q.$where);
      if (hasKeys(filter)) {
        pipeline.push({ $match: filter });
      }
    }

    // $group stage
    const groupId: Record<string, string> = {};
    const groupAccumulators: Record<string, Record<string, unknown>> = {};

    for (const entry of parseGroupMap(q.$group)) {
      if (entry.kind === 'key') {
        groupId[entry.alias] = `$${entry.alias}`;
      } else {
        const mongoOp = MongoDialect.AGGREGATE_OP_MAP[entry.op];
        groupAccumulators[entry.alias] = entry.op === '$count' ? { [mongoOp]: 1 } : { [mongoOp]: `$${entry.fieldRef}` };
      }
    }

    pipeline.push({ $group: { _id: hasKeys(groupId) ? groupId : null, ...groupAccumulators } });

    // Project stage — rename _id fields back to their original names
    if (hasKeys(groupId)) {
      const project: Record<string, unknown> = { _id: 0 };
      for (const alias of Object.keys(groupId)) {
        project[alias] = `$_id.${alias}`;
      }
      for (const alias of Object.keys(groupAccumulators)) {
        project[alias] = 1;
      }
      pipeline.push({ $project: project });
    }

    // $match stage for HAVING (post-group filtering)
    if (q.$having) {
      const havingFilter = this.buildHavingFilter(q.$having);
      if (hasKeys(havingFilter)) {
        pipeline.push({ $match: havingFilter });
      }
    }

    // $sort stage
    if (q.$sort) {
      const sort = this.sort(entity, q.$sort);
      if (hasKeys(sort)) {
        pipeline.push({ $sort: sort });
      }
    }

    // $skip and $limit stages
    if (q.$skip !== undefined) {
      pipeline.push({ $skip: q.$skip });
    }
    if (q.$limit !== undefined) {
      pipeline.push({ $limit: q.$limit });
    }

    return pipeline;
  }

  private buildHavingFilter(having: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    for (const [alias, condition] of Object.entries(having)) {
      if (condition === undefined) continue;
      if (typeof condition === 'number') {
        filter[alias] = condition;
      } else if (typeof condition === 'object' && condition !== null) {
        filter[alias] = this.transformOperators(condition as Record<string, unknown>);
      }
    }
    return filter;
  }

  /**
   * Separate vector sort entries from regular sort entries.
   * Returns `undefined` if no vector sort is present.
   */
  extractVectorSort<E extends Document>(sort: QuerySortMap<E> | undefined): ExtractedVectorSort<E> | undefined {
    if (!sort) return undefined;
    const raw = buildSortMap(sort);
    let vectorKey: string | undefined;
    let vectorSearch: QueryVectorSearch | undefined;
    const regularSort = {} as QuerySortMap<E>;

    for (const [key, value] of Object.entries(raw)) {
      if (isVectorSearch(value)) {
        vectorKey = key;
        vectorSearch = value;
      } else {
        (regularSort as Record<string, unknown>)[key] = value;
      }
    }

    if (!vectorKey || !vectorSearch) return undefined;

    return { vectorKey, vectorSearch, regularSort };
  }

  /**
   * Build a `$vectorSearch` aggregation pipeline stage.
   * Merges `$where` into `$vectorSearch.filter` for optimal pre-filtering.
   */
  buildVectorSearchStage<E extends Document>(
    entity: Type<E>,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
    where: QueryWhere<E> | undefined,
    limit: number,
  ): Record<string, unknown> {
    const field = meta.fields[key];
    if (!field) {
      throw new TypeError(`Field '${key}' not found in entity '${meta.name}'`);
    }
    const colName = this.resolveColumnName(key, field);

    // Resolve index name from @Index metadata, or fall back to convention
    const indexMeta = meta.indexes?.find(
      (idx) => idx.columns.includes(key) && MongoDialect.VECTOR_INDEX_TYPES.has(idx.type!),
    );
    const indexName = indexMeta?.name ?? `${colName}_index`;

    const stage: Record<string, unknown> = {
      index: indexName,
      path: colName,
      queryVector: [...search.$vector],
      numCandidates: limit * 10,
      limit,
    };

    // Pre-filter: merge $where into $vectorSearch.filter
    if (where) {
      const filter = this.where(entity, where);
      if (hasKeys(filter)) {
        stage['filter'] = filter;
      }
    }

    return { $vectorSearch: stage };
  }
}

export type MongoAggregationPipelineEntry<E extends Document> = {
  $lookup?: MongoAggregationLookup<E>;
  $match?: Filter<E> | Record<string, unknown>;
  $sort?: Sort;
  $unwind?: MongoAggregationUnwind;
  $group?: Record<string, unknown>;
  $project?: Record<string, unknown>;
  $skip?: number;
  $limit?: number;
};

type MongoAggregationLookup<E extends Document> = {
  readonly from?: string;
  readonly foreignField?: string;
  readonly localField?: string;
  readonly pipeline?: MongoAggregationPipelineEntry<FieldValue<E>>[];
  readonly as?: RelationKey<E>;
};

type MongoAggregationUnwind = {
  readonly path?: string;
  readonly preserveNullAndEmptyArrays?: boolean;
};

type IdValue = string | ObjectId;

export type ExtractedVectorSort<E> = {
  readonly vectorKey: string;
  readonly vectorSearch: QueryVectorSearch;
  readonly regularSort: QuerySortMap<E>;
};
