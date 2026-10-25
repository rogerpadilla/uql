import { describe, expect, it, vi } from 'vitest';
import { withContext } from '../context/context.js';
import { Entity, f, Field, getMeta } from '../entity/index.js';
import { type Item, User } from '../test/entityMock.js';
import type { Json, JsonArrayUpdateOp, QueryAggMap, QueryGroupMap, QuerySelect, QueryWhere } from '../type/index.js';
import {
  applyFilters,
  isSelectList,
  fillOnFields,
  filterFieldKeys,
  findVectorIndex,
  foldJson,
  writesKeys,
  fulltextWeights,
  getFieldCallbackValue,
  guardWrite,
  insertShapeOf,
  isCascadable,
  normalizeScalarFieldSelection,
  parseGroupMap,
  textSearchFields,
  deletionOf,
  upsertAssigned,
} from './dialect.util.js';
import { withDeleted } from './filters.util.js';
import { sql } from './sql.js';
import { UqlSecurityError } from './uqlError.js';

@Entity({
  filters: {
    recent: { where: () => ({ status: 'new' }), default: false },
    active: { where: { status: 'active' }, default: false },
  },
})
class Filtered {
  @Field(f.number().id())
  id?: number;
  @Field(f.string().nullable())
  status?: string | null;
  @Field(f.date().nullable().softDelete())
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
  @Entity({
    filters: { mine: { where: (ctx) => (ctx?.['userId'] ? { ownerId: ctx['userId'] as number } : undefined) } },
  })
  class Owned {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable()) ownerId?: number | null;
  }
  expect(applyFilters(getMeta(Owned), {})).toEqual({});
});

it('should disable the soft-delete filter alone, keeping the other options and filters: false as they are', () => {
  expect(withDeleted({ filters: { active: true }, hardDelete: true })).toEqual({
    filters: { active: true, softDelete: false },
    hardDelete: true,
  });
  expect(withDeleted()).toEqual({ filters: { softDelete: false } });
  expect(withDeleted({ filters: false })).toEqual({ filters: false });
});

it('should not overwrite a key already in $where', () => {
  const d = new Date();
  expect(applied({ deletedAt: d })).toEqual({ deletedAt: d });
});

@Entity({
  filters: {
    tenant: {
      where: (ctx) => (ctx?.['tenantId'] != null ? { companyId: ctx['tenantId'] as number } : undefined),
      security: true,
    },
  },
})
class Tenanted {
  @Field(f.number().id())
  id?: number;
  @Field(f.number().nullable())
  companyId?: number | null;
  @Field(f.date().nullable().softDelete())
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

it("should fill an inserted row's guarded field from a security filter, and no other filter's", () => {
  const rows: Tenanted[] = [{ id: 1 }];
  withContext({ tenantId: 5 }, () => guardWrite(getMeta(Tenanted), rows, 'insert'));
  expect(rows).toEqual([{ id: 1, companyId: 5 }]);
});

it('should leave an update payload without the guarded field as it is', () => {
  const rows: Tenanted[] = [{ deletedAt: null }];
  withContext({ tenantId: 5 }, () => guardWrite(getMeta(Tenanted), rows, 'update'));
  expect(rows).toEqual([{ deletedAt: null }]);
});

it('should refuse a write naming another value for a guarded field', () => {
  const write = () => withContext({ tenantId: 5 }, () => guardWrite(getMeta(Tenanted), [{ companyId: 6 }], 'update'));
  expect(write).toThrow("'Tenanted' row sets 'companyId' outside security filter 'tenant'");
});

it('should fail closed on a write whose security context is missing', () => {
  expect(() => guardWrite(getMeta(Tenanted), [{ id: 1 }], 'insert')).toThrow(UqlSecurityError);
});

@Entity({ filters: { tenants: { where: { companyId: { $in: [1, 2] } }, security: true } } })
class MultiTenanted {
  @Field(f.number().id())
  id?: number;
  @Field(f.number().nullable())
  companyId?: number | null;
}

it('should refuse a write against a security condition that is not field equalities', () => {
  expect(() => guardWrite(getMeta(MultiTenanted), [{ companyId: 1 }], 'insert')).toThrow(
    "'MultiTenanted' security filter 'tenants' is not field equalities, so no write can be checked against it",
  );
});

it('should read a condition resolving to {} as no restriction, merging nothing', () => {
  @Entity({
    filters: {
      workspace: {
        where: (ctx) =>
          ctx?.['system'] ? {} : ctx?.['tenantId'] != null ? { companyId: ctx['tenantId'] as number } : undefined,
        security: true,
      },
    },
  })
  class SystemScoped {
    @Field(f.number().id())
    id?: number;
    @Field(f.number().nullable())
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

it("should stamp a soft delete from its option: the current time, a callback's result, or the value itself", () => {
  @Entity()
  class Dated {
    @Field(f.number().id()) id?: number;
    @Field(f.date().nullable().softDelete()) deletedAt?: Date | null;
  }
  @Entity()
  class Counted {
    @Field(f.number().id()) id?: number;
    @Field(
      f
        .number()
        .nullable()
        .softDelete(() => 42),
    )
    deletedAt?: number | null;
  }
  @Entity()
  class Marked {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable().softDelete('DELETED')) status?: string | null;
  }

  expect(stampOf(deletionOf(getMeta(Dated), {})).value()).toBeInstanceOf(Date);
  expect(stampOf(deletionOf(getMeta(Counted), {})).value()).toBe(42);
  expect(stampOf(deletionOf(getMeta(Marked), {})).value()).toBe('DELETED');
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
  expect(normalizeScalarFieldSelection(meta, { name: false } satisfies QuerySelect<User>)).not.toContain('name');
  expect(normalizeScalarFieldSelection(meta, { name: false } satisfies QuerySelect<User>)).not.toContain('name');
});

@Entity()
class LazyId {
  @Field(f.number().id().eager(false))
  id?: number;
  @Field(f.string().nullable())
  name?: string | null;
}

it('should drop an eager: false id from the default selection', () => {
  const meta = getMeta(LazyId);
  expect(normalizeScalarFieldSelection(meta)).not.toContain('id');
});

it('should leave out every field a falsy $select map names', () => {
  const meta = getMeta(User);
  const fields = normalizeScalarFieldSelection(meta, { name: false, id: false } satisfies QuerySelect<User>);
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

/** A path names one field, one key at each level: a captured query's type says so, an open map's run time. */
it('should reject a group path naming no field, or two', () => {
  expect(() => parseGroupMap<Item>({ both: { tax: { name: true, id: true } } })).toThrow(
    `$group 'both' names one field by the path to it: got {"name":true,"id":true}`,
  );
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
  @Entity({ indexes: (article, index) => [index([article.title, article.body], { type: 'fulltext' })] })
  class Article {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) title?: string | null;
    @Field(f.string().nullable()) body?: string | null;
    @Field(f.string().nullable()) summary?: string | null;
  }

  @Entity()
  class Plain {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) title?: string | null;
  }

  @Entity({
    indexes: (twiceIndexed, index) => [
      index([twiceIndexed.body], { type: 'fulltext' }),
      index([twiceIndexed.title], { type: 'fulltext' }),
    ],
  })
  class TwiceIndexed {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) title?: string | null;
    @Field(f.string().nullable()) body?: string | null;
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

  it('should search only the plain columns of the fulltext index it reads', () => {
    @Entity({
      indexes: (lowered, index) => [index([sql`lower(${lowered.title})`, lowered.body], { type: 'fulltext' })],
    })
    class Lowered {
      @Field(f.number().id()) id?: number;
      @Field(f.string().nullable()) title?: string | null;
      @Field(f.string().nullable()) body?: string | null;
    }
    expect(textSearchFields(getMeta(Lowered), { $value: 'x' })).toEqual(['body']);
  });

  it('should not search the JSON column a fulltext entry reads a path of, which a search of whole columns never reads', () => {
    @Entity({ indexes: (pathed, index) => [index([pathed.meta.title, pathed.title], { type: 'fulltext' })] })
    class Pathed {
      @Field(f.number().id()) id?: number;
      @Field(f.string().nullable()) title?: string | null;
      @Field(f.jsonb().nullable()) meta?: Json<{ title: string }> | null;
    }
    expect(textSearchFields(getMeta(Pathed), { $value: 'x' })).toEqual(['title']);
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

it('should tell a $select list from its map form', () => {
  expect(isSelectList<User>([sql`1`])).toBe(true);
  expect(isSelectList<User>({ name: true })).toBe(false);
  expect(isSelectList<User>(undefined)).toBe(false);
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

describe('fulltextWeights', () => {
  const fulltext = (...weights: (number | undefined)[]) => ({
    type: 'fulltext' as const,
    entries: weights.map((weight) => ({ weight })),
  });

  it('should weigh nothing where no column states a weight', () => {
    expect(fulltextWeights(fulltext(undefined, undefined))).toBeUndefined();
  });

  it('should weigh nothing where every column weighs the same', () => {
    expect(fulltextWeights(fulltext(2, 2))).toBeUndefined();
  });

  it('should weigh a column stating none as 1 beside one that does', () => {
    expect(fulltextWeights(fulltext(3, undefined))).toEqual([3, 1]);
  });

  it('should refuse a weight on an index of no stated type, which is a btree', () => {
    expect(() => fulltextWeights({ entries: [{ weight: 2 }] })).toThrow(
      'a column weight ranks a fulltext index, and this one is btree',
    );
  });
});

describe('findVectorIndex', () => {
  it('should find the vector index over a column', () => {
    @Entity({ indexes: (indexed, index) => [index([indexed.embedding], { type: 'hnsw', distance: 'cosine' })] })
    class Indexed {
      @Field(f.number().id()) id?: number;
      @Field(f.vector(3).nullable()) embedding?: number[] | null;
    }
    expect(findVectorIndex(getMeta(Indexed), 'embedding')?.type).toBe('hnsw');
  });

  it('should ignore an expression index, whose text names no column however it reads', () => {
    @Entity({ indexes: (expressed, index) => [index([sql`embedding`], { type: 'hnsw', distance: 'cosine' })] })
    class Expressed {
      @Field(f.number().id()) id?: number;
      @Field(f.vector(3).nullable()) embedding?: number[] | null;
    }
    expect(findVectorIndex(getMeta(Expressed), 'embedding')).toBeUndefined();
  });
});

describe('fillOnFields', () => {
  @Entity()
  class Zeroed {
    @Field(f.number().id()) id?: number;
    @Field(f.number().nullable().onInsert(0)) count?: number | null;
    @Field(f.string().nullable().onInsert('')) note?: string | null;
    @Field(f.boolean().nullable().onInsert(false)) flag?: boolean | null;
  }

  it('should fill a falsy value where the caller left the field unset', () => {
    expect(fillOnFields(getMeta(Zeroed), { id: 1 }, 'onInsert')).toEqual([{ id: 1, count: 0, note: '', flag: false }]);
  });

  it('should keep a value the caller set', () => {
    expect(fillOnFields(getMeta(Zeroed), { id: 1, count: 5, note: 'x', flag: true }, 'onInsert')).toEqual([
      { id: 1, count: 5, note: 'x', flag: true },
    ]);
  });
});

describe('upsertAssigned', () => {
  @Entity()
  class Stamped {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) code?: string | null;
    @Field(f.string().nullable()) name?: string | null;
    @Field(
      f
        .number()
        .nullable()
        .onInsert(() => calls.push('onInsert')),
    )
    createdAt?: number | null;
    @Field(
      f
        .number()
        .nullable()
        .onUpdate(() => 7),
    )
    updatedAt?: number | null;
  }
  const calls: string[] = [];
  const meta = getMeta(Stamped);

  it('should assign a found row the payload and the onUpdate fills, less its key and what it matched on', () => {
    calls.length = 0;

    expect(upsertAssigned(meta, { id: 1, code: 'a', name: 'n' }, { code: true })).toEqual({ name: 'n', updatedAt: 7 });
    expect(calls).toEqual([]);
  });
});

describe('a delete of a soft-deletable entity', () => {
  @Entity()
  class Trashed {
    @Field(f.number().id()) id?: number;
    @Field(
      f
        .number()
        .nullable()
        .softDelete(() => 9),
    )
    deletedAt?: number | null;
  }
  const meta = getMeta(Trashed);

  it('should stamp its soft-delete field, reading the rows as asked, its value left to the writer', () => {
    const softDelete = vi.fn(() => 9);
    @Entity()
    class Stamped {
      @Field(f.number().id()) id?: number;
      @Field(f.number().nullable().softDelete(softDelete)) deletedAt?: number | null;
    }
    const stamped = getMeta(Stamped);

    const deletion = deletionOf(stamped, {});

    expect(deletion).toMatchObject({ stamp: { key: 'deletedAt' }, opts: {} });
    expect(softDelete).not.toHaveBeenCalled();
    expect(stampOf(deletion).value()).toBe(9);
    expect(softDelete).toHaveBeenCalledOnce();
  });

  it('should remove the rows on a hard delete, soft-deleted ones included', () => {
    expect(deletionOf(meta, { hardDelete: true })).toEqual({
      opts: { hardDelete: true, filters: { softDelete: false } },
    });
  });
});

describe('foldJson', () => {
  it('pulls each element, then pushes each, then adds each once, unguarded where a pull removed it', () => {
    expect(foldJson({ $pull: ['a', null], $push: ['b', 'b'], $addToSet: ['a', 'c', 'c', 'b'] })).toEqual({
      array: {
        pulls: ['a', null],
        appends: [
          { item: 'b', unique: false },
          { item: 'b', unique: false },
          { item: 'a', unique: false },
          { item: 'c', unique: true },
        ],
      },
    });
  });

  it('folds an update whose operands are maps of keys as an object update', () => {
    expect(foldJson({ $pull: { tags: 'a' } })).toEqual({
      object: { set: {}, arrays: { tags: { pulls: ['a'], appends: [] } }, unset: [] },
    });
  });

  it('refuses a map of keys or a $set beside a list, and an $addToSet element that is no scalar', () => {
    const message = 'a JSON array takes $pull, $push and $addToSet, each a list of elements';
    const pullingKeys: JsonArrayUpdateOp = { $push: ['a'] };
    const setting: JsonArrayUpdateOp = { $push: ['a'] };
    const addingObjects: JsonArrayUpdateOp = {};
    Reflect.set(pullingKeys, '$pull', { tags: 'a' });
    Reflect.set(setting, '$set', { a: 1 });
    Reflect.set(addingObjects, '$addToSet', [{ a: 1 }]);
    expect(() => foldJson(pullingKeys)).toThrow(message);
    expect(() => foldJson(setting)).toThrow(message);
    expect(() => foldJson(addingObjects)).toThrow('$addToSet takes a string, a finite number or a boolean');
  });
});

describe('foldJson of an object update', () => {
  it('names each path once, in operator order', () => {
    expect(
      foldJson({
        $pull: { tags: 'a', old: 1 },
        $set: { theme: { color: 'red' }, 'theme.size': 2, private: 1, old: [0], skipped: undefined },
        $push: { tags: 'b', old: 2 },
        $addToSet: { tags: 'a', labels: 'x' },
        $unset: ['private', 'theme.color', 'gone'],
      }),
    ).toEqual({
      object: {
        set: { theme: { size: 2 }, old: [0, 2] },
        arrays: {
          tags: {
            pulls: ['a'],
            appends: [
              { item: 'b', unique: false },
              { item: 'a', unique: false },
            ],
          },
          labels: { pulls: [], appends: [{ item: 'x', unique: true }] },
        },
        unset: ['private', 'gone'],
      },
    });
  });

  it('leaves a set value that is no array to an append, and makes an array of a null one', () => {
    expect(foldJson({ $set: { a: 'x', b: null, c: ['y'] }, $push: { a: 1, b: 2 }, $addToSet: { c: 'y' } })).toEqual({
      object: { set: { a: 'x', b: [2], c: ['y'] }, arrays: {}, unset: [] },
    });
  });

  it('drops an append under a key a dotted set made an object, and an array write a set or unset replaces', () => {
    expect(foldJson({ $pull: { a: 1 }, $set: { 'b.c': 1 }, $push: { b: 2 }, $unset: ['a'] })).toEqual({
      object: { set: { 'b.c': 1 }, arrays: {}, unset: ['a'] },
    });
  });

  it('writes no key with only a pull and an unset', () => {
    expect(writesKeys({ set: {}, arrays: { tags: { pulls: ['a'], appends: [] } }, unset: ['old'] })).toBe(false);
  });

  it('appends an item once, beside an earlier append of it', () => {
    expect(foldJson({ $push: { tags: 'x' }, $addToSet: { tags: 'x' } })).toEqual({
      object: { set: {}, arrays: { tags: { pulls: [], appends: [{ item: 'x', unique: false }] } }, unset: [] },
    });
  });

  it('writes and removes inside a value a $set wrote, deeply, making an object of one that is none', () => {
    expect(
      foldJson({
        $set: { a: 'x', 'a.b.c': 1, d: { e: { f: 1, g: 2 } }, 'd.e.h': 3, h: 'y', i: { j: 1 } },
        $unset: ['d.e.f', 'h.k', 'i.missing'],
      }),
    ).toEqual({
      object: { set: { a: { b: { c: 1 } }, d: { e: { g: 2, h: 3 } }, h: 'y', i: { j: 1 } }, arrays: {}, unset: [] },
    });
  });

  it('writes a key named after an object member as a key, touching no prototype', () => {
    const update = foldJson({ $set: { ['__proto__']: { a: 1 }, '__proto__.b': 2, 'constructor.c': 3 } });
    expect(Object.hasOwn(Object.prototype, 'b')).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'c')).toBe(false);
    expect(update).toEqual({
      object: { set: { ['__proto__']: { a: 1, b: 2 }, 'constructor.c': 3 }, arrays: {}, unset: [] },
    });
  });

  it('refuses another operator inside a value set by sql', () => {
    expect(() => foldJson({ $set: { tags: sql`'[]'` }, $push: { tags: 'x' } })).toThrow(
      "'tags' is set by sql, so no other operator can write inside it",
    );
    expect(() => foldJson({ $set: { theme: sql`'{}'`, 'theme.color': 'x' } })).toThrow(
      "'theme' is set by sql, so no other operator can write inside it",
    );
    expect(() => foldJson({ $set: { theme: sql`'{}'` }, $unset: ['theme.color'] })).toThrow(
      "'theme' is set by sql, so no other operator can write inside it",
    );
  });

  it('refuses a path that is not one, and an $addToSet element JSON compares by more than value', () => {
    expect(() => foldJson({ $set: { 'a.$x': 1 } })).toThrow();
    expect(() => foldJson({ $push: { 'a.b': 1 } })).toThrow();
    expect(() => foldJson({ $addToSet: { tags: { id: 1 } } })).toThrow(
      "$addToSet on 'tags' takes a string, a finite number or a boolean",
    );
  });
});

/** The stamp a soft delete of `deletion` writes, failing plainly where it is a hard one. */
function stampOf({ stamp }: ReturnType<typeof deletionOf>): { value(): unknown } {
  if (!stamp) {
    throw new Error('a hard delete stamps nothing');
  }
  return stamp;
}
