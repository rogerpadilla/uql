import { describe, expect, it } from 'vitest';
import { UqlSecurityError, withContext } from '../context/context.js';
import { Entity, Field, Filter, getMeta, Id, Index } from '../entity/index.js';
import { type Item, User } from '../test/entityMock.js';
import { idKey } from '../type/index.js';
import type { QueryAggMap, QueryGroupMap, QuerySelect, QueryWhere } from '../type/index.js';
import {
  applyFilters,
  asSelectMap,
  assertWhere,
  fillOnFields,
  filterFieldKeys,
  findVectorIndex,
  getFieldCallbackValue,
  getSoftDeleteValue,
  insertShapeOf,
  isCascadable,
  normalizeScalarFieldSelection,
  parseGroupMap,
  textSearchFields,
  whereIds,
  withoutSoftDeleteFilter,
} from './dialect.util.js';
import { raw } from './raw.js';

@Filter('active', { where: { status: 'active' }, default: false })
@Filter('recent', { where: () => ({ status: 'new' }), default: false })
@Entity()
class Filtered {
  @Field({ type: Number, isId: true })
  id?: number;
  @Field({ type: String })
  status?: string | null;
  @Field({ type: Date, softDelete: true })
  deletedAt?: Date | null;
}

function applied(where: QueryWhere<Filtered>, opts?: Parameters<typeof applyFilters>[2]) {
  return applyFilters(getMeta(Filtered), where, opts);
}

it('should apply default-on filters (soft-delete) and skip default-off ones', () => {
  expect(applied({})).toEqual({ deletedAt: null });
});

it('should disable every filter on filters: false', () => {
  expect(applied({}, { filters: false })).toEqual({});
});

it('should disable one filter by name, and force-enable a default-off one', () => {
  expect(applied({}, { filters: { softDelete: false } })).toEqual({});
  expect(applied({}, { filters: { active: true } })).toEqual({ status: 'active', deletedAt: null });
});

it('should resolve thunk conditions', () => {
  expect(applied({}, { filters: { recent: true } })).toEqual({ status: 'new', deletedAt: null });
});

it('should skip a convenience filter whose condition does not resolve', () => {
  @Filter('mine', { where: (ctx) => (ctx?.['userId'] ? { ownerId: ctx['userId'] as number } : undefined) })
  @Entity()
  class Owned {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) ownerId?: number | null;
  }
  expect(applyFilters(getMeta(Owned), {})).toEqual({});
});

it('should disable the soft-delete filter alone, keeping filters: false as it is', () => {
  expect(withoutSoftDeleteFilter({ active: true })).toEqual({ active: true, softDelete: false });
  expect(withoutSoftDeleteFilter(undefined)).toEqual({ softDelete: false });
  expect(withoutSoftDeleteFilter(false)).toBe(false);
});

it('should not overwrite a key already in $where', () => {
  const d = new Date();
  expect(applied({ deletedAt: d })).toEqual({ deletedAt: d });
});

@Filter('tenant', {
  where: (ctx) => (ctx?.['tenantId'] != null ? { companyId: ctx['tenantId'] as number } : undefined),
  security: true,
})
@Entity()
class Tenanted {
  @Field({ type: Number, isId: true })
  id?: number;
  @Field({ type: Number })
  companyId?: number | null;
  @Field({ type: Date, softDelete: true })
  deletedAt?: Date | null;
}

function tenantApplied(where: QueryWhere<Tenanted>, opts?: Parameters<typeof applyFilters>[2]) {
  return applyFilters(getMeta(Tenanted), where, opts);
}

it("should AND a security filter's condition from the ambient context", () => {
  const where = withContext({ tenantId: 5 }, () => tenantApplied({}));
  expect(where).toEqual({ deletedAt: null, $and: [{ companyId: 5 }] });
});

it('should keep a security filter on filters: false', () => {
  const where = withContext({ tenantId: 5 }, () => tenantApplied({}, { filters: false }));
  expect(where).toEqual({ $and: [{ companyId: 5 }] }); // softDelete bypassed, tenant still applied
});

it('should keep a security filter against a client $where on the same field', () => {
  const where = withContext({ tenantId: 5 }, () => tenantApplied({ companyId: 99 }));
  // client value stays, but the security predicate is AND-ed, so it is self-contradictory: no leak
  expect(where).toEqual({ companyId: 99, deletedAt: null, $and: [{ companyId: 5 }] });
});

it('should fail closed on a security filter whose context is missing', () => {
  expect(() => tenantApplied({})).toThrow(UqlSecurityError);
});

it('should read a condition resolving to {} as no restriction, merging nothing', () => {
  @Filter('workspace', {
    where: (ctx) =>
      ctx?.['system'] ? {} : ctx?.['tenantId'] != null ? { companyId: ctx['tenantId'] as number } : undefined,
    security: true,
  })
  @Entity()
  class SystemScoped {
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number })
    companyId?: number | null;
  }
  const meta = getMeta(SystemScoped);
  // system context: security filter resolves to {} -> no $and appended, no broken predicate
  expect(withContext({ system: true }, () => applyFilters(meta, {}))).toEqual({});
  // tenant context still scopes
  expect(withContext({ tenantId: 3 }, () => applyFilters(meta, {}))).toEqual({ $and: [{ companyId: 3 }] });
  // missing context still fails closed
  expect(() => applyFilters(meta, {})).toThrow(UqlSecurityError);
});

it('should return a new where map, never mutating the input', () => {
  const input: QueryWhere<Filtered> = { status: 'x' };
  const out = applied(input);
  expect(input).toEqual({ status: 'x' }); // input untouched - no injected `deletedAt`
  expect(out).not.toBe(input);
});

it('should not mutate a client $and array when AND-merging a security filter', () => {
  const clientAnd: QueryWhere<Tenanted>[] = [{ companyId: 1 }];
  const input: QueryWhere<Tenanted> = { $and: clientAnd };
  const out = withContext({ tenantId: 5 }, () => tenantApplied(input));
  expect(clientAnd).toEqual([{ companyId: 1 }]); // original array untouched
  expect(out.$and).toEqual([{ companyId: 1 }, { companyId: 5 }]);
});

/** Deliberately invalid entries plus one valid key - exercises parseGroupMap defensive parsing. */
function malformedGroupMapFixture(): QueryGroupMap<Item> {
  // @ts-expect-error: no entry names a group function
  return { a: false, b: 0, c: '', d: true };
}

it("should read a field callback's value, or the value itself", () => {
  expect(getFieldCallbackValue(() => 'fn')).toBe('fn');
  expect(getFieldCallbackValue('val')).toBe('val');
});

it('should stamp a soft delete from its option', () => {
  // `true` stamps the current timestamp
  expect(getSoftDeleteValue({ softDelete: true })).toBeInstanceOf(Date);
  // a callback stamps its result
  expect(getSoftDeleteValue({ softDelete: () => 42 })).toBe(42);
  // a scalar stamps as-is
  expect(getSoftDeleteValue({ softDelete: 'DELETED' })).toBe('DELETED');
});

it('should keep the keys a write may set', () => {
  const meta = getMeta(User);
  expect(filterFieldKeys(meta, { id: '1', name: 'John' }, 'onInsert')).toEqual(['id', 'name']);
  // email is not updatable
  expect(filterFieldKeys(meta, { email: 'a@b.com' }, 'onUpdate')).toEqual([]);
});

it('should fill the onInsert fields a payload lacks', () => {
  const meta = getMeta(User);
  const payload: Partial<User> & { id: string } = { id: '1' };
  fillOnFields(meta, payload, 'onInsert');
  expect(payload.createdAt).toBeLessThanOrEqual(Date.now());
});

it('should select the scalar fields a projection names', () => {
  const meta = getMeta(User);
  expect(normalizeScalarFieldSelection(meta, { name: true } satisfies QuerySelect<User>)).toEqual(['name']);
  expect(normalizeScalarFieldSelection(meta, undefined, { name: true } satisfies QuerySelect<User>)).not.toContain(
    'name',
  );
  expect(normalizeScalarFieldSelection(meta, { name: false } satisfies QuerySelect<User>)).not.toContain('name');
});

@Entity()
class LazyId {
  @Id({ type: Number, eager: false })
  id?: number;
  @Field({ type: String })
  name?: string | null;
}

it('should drop an eager: false id from the default selection', () => {
  const meta = getMeta(LazyId);
  expect(normalizeScalarFieldSelection(meta)).not.toContain('id');
});

it('should drop an id excluded by $exclude on a top-level query', () => {
  const meta = getMeta(User);
  expect(normalizeScalarFieldSelection(meta, undefined, { id: true } satisfies QuerySelect<User>)).not.toContain('id');
});

it('should allow a falsy $select map beside $exclude', () => {
  const meta = getMeta(User);
  const fields = normalizeScalarFieldSelection(
    meta,
    { name: false } satisfies QuerySelect<User>,
    {
      id: true,
    } satisfies QuerySelect<User>,
  );
  expect(fields).not.toContain('name');
  expect(fields).not.toContain('id');
});

it('should not cascade a delete from a persist-only relation', () => {
  expect(isCascadable('persist', 'delete')).toBe(false);
});

it('should parse group keys and aggregate functions', () => {
  const group: QueryGroupMap<Item> = { code: true };
  const agg: QueryAggMap<Item> = {
    count: { $count: '*' },
    total: { $sum: { salePrice: true } },
  };
  const entries = parseGroupMap(group, agg);
  expect(entries).toEqual([
    { kind: 'key', alias: 'code', path: ['code'] },
    { kind: 'fn', alias: 'count', op: '$count', distinct: false },
    { kind: 'fn', alias: 'total', op: '$sum', field: 'salePrice', distinct: false },
  ]);
});

it('should parse a group key reaching through relations, and an aggregate filtering its rows', () => {
  const entries = parseGroupMap<Item>(
    { taxName: { tax: { name: true } } },
    { total: { $sum: { salePrice: true }, $where: { code: 'a' } }, all: { $count: '*', $where: {} } },
  );
  expect(entries).toEqual([
    { kind: 'key', alias: 'taxName', path: ['tax', 'name'] },
    { kind: 'fn', alias: 'total', op: '$sum', field: 'salePrice', distinct: false, where: { code: 'a' } },
    { kind: 'fn', alias: 'all', op: '$count', distinct: false },
  ]);
});

/** Wire input, past the types: an aggregate names an op beside its `$where`, and a path is a map. */
it('should reject an aggregate naming no op, and a group path that is no map', () => {
  // @ts-expect-error: an aggregate names an op
  expect(() => parseGroupMap<Item>(undefined, { n: { $where: { code: 'a' } } })).toThrow(
    "aggregate 'n' names no op, only a $where",
  );
  // @ts-expect-error: a path is a map
  expect(() => parseGroupMap<Item>({ code: 5 })).toThrow("$group 'code' names one field by the path to it: got 5");
});

/** Wire input, past the types: a path names one field, one key at each level. */
it('should reject a group path naming no field, or two', () => {
  // @ts-expect-error: a path names one field
  expect(() => parseGroupMap<Item>({ both: { tax: { name: true, id: true } } })).toThrow(
    `$group 'both' names one field by the path to it: got {"name":true,"id":true}`,
  );
  // @ts-expect-error: a path names a field
  expect(() => parseGroupMap<Item>({ none: { tax: {} } })).toThrow(
    `$group 'none' names one field by the path to it: got {}`,
  );
});

it('should normalize a flat distinct function to its base', () => {
  const agg: QueryAggMap<Item> = { codes: { $countDistinct: { code: true } } };
  const entries = parseGroupMap(undefined, agg);
  expect(entries).toEqual([{ kind: 'fn', alias: 'codes', op: '$count', field: 'code', distinct: true }]);
});

/** Wire input, past the types: `'*'` counts rows, which no other op can read, `SUM(*)` failing on every engine. */
it("should reject '*' on an op that reads a field", () => {
  // @ts-expect-error: only $count takes '*'
  expect(() => parseGroupMap(undefined, { total: { $sum: '*' } })).toThrow(
    "aggregate 'total' takes '*' only as a $count",
  );
  // @ts-expect-error: a distinct count reads the field it deduplicates
  expect(() => parseGroupMap(undefined, { codes: { $countDistinct: '*' } })).toThrow(
    "aggregate 'codes' takes '*' only as a $count",
  );
});

/** Wire input, past the types: an aggregate reads one field named as a key, or `'*'`, and nothing else. */
it('should reject an aggregate argument that is not one field', () => {
  const rejected = "aggregate 'total' takes one field as { field: true }, or '*': got ";
  // @ts-expect-error: a function takes one field
  expect(() => parseGroupMap(undefined, { total: { $sum: undefined } })).toThrow(`${rejected}undefined`);
  // @ts-expect-error: a function takes one field
  expect(() => parseGroupMap(undefined, { total: { $sum: {} } })).toThrow(`${rejected}{}`);
  // @ts-expect-error: a function takes one field
  expect(() => parseGroupMap(undefined, { total: { $sum: { salePrice: false } } })).toThrow(
    `${rejected}{"salePrice":false}`,
  );
  // @ts-expect-error: a function takes one field
  expect(() => parseGroupMap(undefined, { total: { $sum: { salePrice: true, code: true } } })).toThrow(
    `${rejected}{"salePrice":true,"code":true}`,
  );
  // @ts-expect-error: a function takes one field
  expect(() => parseGroupMap(undefined, { total: { $sum: 'salePrice' } })).toThrow(`${rejected}"salePrice"`);
});

describe('textSearchFields', () => {
  @Entity()
  @Index((article) => [article.title, article.body], { type: 'fulltext' })
  class Article {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) title?: string | null;
    @Field({ type: String }) body?: string | null;
    @Field({ type: String }) summary?: string | null;
  }

  @Entity()
  class Plain {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) title?: string | null;
  }

  @Entity()
  @Index((twiceIndexed) => [twiceIndexed.title], { type: 'fulltext' })
  @Index((twiceIndexed) => [twiceIndexed.body], { type: 'fulltext' })
  class TwiceIndexed {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) title?: string | null;
    @Field({ type: String }) body?: string | null;
  }

  it('should search the fields it names, whatever the entity declares', () => {
    expect(textSearchFields(getMeta(Article), { $fields: { summary: true }, $value: 'x' })).toEqual(['summary']);
    expect(textSearchFields(getMeta(Article), { $fields: { summary: true, title: false }, $value: 'x' })).toEqual([
      'summary',
    ]);
  });

  /** The declaration MySQL's `MATCH` has to match exactly, and the one a MongoDB text index is. */
  it('should search the columns of the fulltext index the entity declares where it names none', () => {
    expect(textSearchFields(getMeta(Article), { $value: 'x' })).toEqual(['title', 'body']);
    expect(textSearchFields(getMeta(Article), { $fields: {}, $value: 'x' })).toEqual(['title', 'body']);
  });

  it('should refuse to guess where the entity declares no fulltext index, or more than one', () => {
    expect(() => textSearchFields(getMeta(Plain), { $value: 'x' })).toThrow(
      "$text on 'Plain' names no $fields, and 'Plain' declares no fulltext index to search. Name them with $fields.",
    );
    expect(() => textSearchFields(getMeta(TwiceIndexed), { $value: 'x' })).toThrow(
      "$text on 'TwiceIndexed' names no $fields, and 'TwiceIndexed' declares 2 fulltext indexes to choose from. Name them with $fields.",
    );
  });
});

it('should read a raw-array $select as no map', () => {
  expect(asSelectMap<User>([raw`1`])).toBeUndefined();
  expect(asSelectMap<User>({ name: true })).toEqual({ name: true });
});

it('should name only the insertable keys a row carries', () => {
  const meta = getMeta(User);
  // @ts-expect-error: not a field of `User`
  expect(insertShapeOf(meta, { name: 'a', email: undefined, unknown: 1 })).toBe('name,');
});

it('should skip falsy and non-object entries in a group map', () => {
  const entries = parseGroupMap(malformedGroupMapFixture());
  // Only `true` is a valid group key; false/0/'' are ignored
  expect(entries).toEqual([{ kind: 'key', alias: 'd', path: ['d'] }]);
});

@Entity()
class Enrolled {
  [idKey]?: 'studentId' | 'courseId';
  @Id({ type: Number }) studentId?: number;
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string | null;
}

describe('whereIds', () => {
  it('should name the one key column for a bare value, and an `IN` for a list of them', () => {
    expect(whereIds(getMeta(User), '1')).toEqual({ id: '1' });
    expect(whereIds(getMeta(User), ['1', '2'])).toEqual({ id: ['1', '2'] });
    expect(whereIds(getMeta(User), [])).toEqual({ id: [] });
  });

  it('should name a composite row by its key map, which is a `$where` already, and a list of them by an OR', () => {
    const id = { studentId: 1, courseId: 'maths' };
    expect(whereIds(getMeta(Enrolled), id)).toBe(id);
    expect(whereIds(getMeta(Enrolled), [id])).toEqual({ $or: [id] });
  });

  /** A scalar names one column, which on a composite would address every row agreeing on it. */
  it('should refuse a bare value where the key is composite', () => {
    expect(() => whereIds(getMeta(Enrolled), 1)).toThrow(
      /composite primary key \(studentId, courseId\), which addressing by a bare id value does not support/,
    );
    expect(() => whereIds(getMeta(Enrolled), [1, 2])).toThrow(/addressing by a bare id value/);
  });
});

describe('assertWhere', () => {
  it('should pass a map, with or without a prototype', () => {
    expect(() => assertWhere(getMeta(User), { id: '1' })).not.toThrow();
    expect(() => assertWhere(getMeta(User), Object.assign(Object.create(null), { id: '1' }))).not.toThrow();
  });

  /** Untyped JS and parsed JSON can still pass these; read as a map, a scalar has no keys and filters nothing. */
  it.each([
    ['an id', '1'],
    ['a list of ids', [1, 2]],
    ['a bare raw()', raw`a > 1`],
    ['null', null],
  ])('refuses %s', (_, where) => {
    expect(() => assertWhere(getMeta(User), where)).toThrow("$where on 'User' must be a map of conditions");
  });
});

describe('findVectorIndex', () => {
  it('should find the vector index over a column', () => {
    @Index((indexed) => [indexed.embedding], { type: 'hnsw', distance: 'cosine' })
    @Entity()
    class Indexed {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector', dimensions: 3 }) embedding?: number[] | null;
    }
    expect(findVectorIndex(getMeta(Indexed), 'embedding')?.type).toBe('hnsw');
  });

  it('should ignore an expression index, whose text names no column however it reads', () => {
    @Index(() => [raw`embedding`], { type: 'hnsw', distance: 'cosine' })
    @Entity()
    class Expressed {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'vector', dimensions: 3 }) embedding?: number[] | null;
    }
    expect(findVectorIndex(getMeta(Expressed), 'embedding')).toBeUndefined();
  });
});
