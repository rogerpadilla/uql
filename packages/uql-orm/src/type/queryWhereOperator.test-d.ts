/**
 * Type-level regression tests for the type-gated `$where` operators: string operators require
 * string fields, ordering operators comparable fields (string/number/bigint/Date), array operators
 * array fields. Untyped (`unknown`) values stay fully permissive.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Json, Querier } from '../index.js';

class Address {
  city?: string;
  zip?: string;
  price?: number;
}

class Person {
  id!: number;
  name!: string;
  nickname?: string;
  age?: number;
  balance?: bigint;
  active?: boolean;
  bornAt?: Date;
  tags?: string[];
  embedding?: number[];
  addresses?: Json<Address[]>;
  settings?: Json<{ theme?: string }>;
  friends?: Person[];
  manager?: Person;
}

declare const querier: Querier;

export async function whereOperatorGating() {
  // String fields accept string, ordering, and common operators.
  await querier.findMany(Person, {
    $where: {
      name: { $startsWith: 'a', $iendsWith: 'z', $like: '%x%', $regex: '^A' },
      nickname: { $gt: 'a', $between: ['a', 'z'] },
    },
  });

  // Comparable fields accept ordering and common operators. `Date` fields also accept ISO strings
  // (via `ExpandScalar`), including inside `$between`; `bigint` is comparable too.
  await querier.findMany(Person, {
    $where: {
      age: { $gte: 18, $between: [18, 65], $ne: null },
      bornAt: { $lt: new Date(), $gte: '2020-01-01', $between: ['2020-01-01', '2021-01-01'] },
      balance: { $gt: 0n, $between: [0n, 100n] },
      id: { $in: [1, 2], $nin: [3] },
    },
  });

  // Every field accepts equality, membership, and null-check operators. `$not` re-enters the gated
  // value type, so an inapplicable operator nested under it is still rejected.
  await querier.findMany(Person, {
    $where: {
      active: { $eq: true, $isNotNull: true },
      bornAt: { $isNull: true },
      nickname: { $not: { $startsWith: 'x' } },
    },
  });
  // @ts-expect-error $not re-applies gating: $like is invalid on a number field
  await querier.findMany(Person, { $where: { age: { $not: { $like: 'x' } } } });

  // Array fields accept array operators, with element-typed values.
  await querier.findMany(Person, {
    $where: {
      tags: { $all: ['typescript', 'orm'] },
      embedding: { $size: { $gt: 0, $lte: 5 } },
      addresses: { $elemMatch: { city: 'NYC', zip: { $startsWith: '10' } } },
    },
  });

  // String operators are rejected on non-string fields.
  // @ts-expect-error $like requires a string field
  await querier.findMany(Person, { $where: { age: { $like: '3%' } } });
  // @ts-expect-error $startsWith requires a string field
  await querier.findMany(Person, { $where: { bornAt: { $startsWith: '20' } } });
  // @ts-expect-error $regex requires a string field
  await querier.findMany(Person, { $where: { active: { $regex: '^t' } } });

  // Ordering operators are rejected on non-comparable fields.
  // @ts-expect-error $gt requires a comparable field
  await querier.findMany(Person, { $where: { active: { $gt: false } } });
  // @ts-expect-error $between requires a comparable field
  await querier.findMany(Person, { $where: { active: { $between: [false, true] } } });

  // Array operators are rejected on scalar fields.
  // @ts-expect-error $all requires an array field
  await querier.findMany(Person, { $where: { name: { $all: ['a'] } } });
  // @ts-expect-error $size requires an array field
  await querier.findMany(Person, { $where: { age: { $size: 3 } } });
  // @ts-expect-error $elemMatch requires an array field
  await querier.findMany(Person, { $where: { name: { $elemMatch: { city: 'NYC' } } } });

  // Operator values keep the field's own type.
  // @ts-expect-error $startsWith takes a string
  await querier.findMany(Person, { $where: { name: { $startsWith: 1 } } });
  // @ts-expect-error $elemMatch keys come from the element type
  await querier.findMany(Person, { $where: { addresses: { $elemMatch: { town: 'NYC' } } } });

  // Bare arrays are an implicit $in for scalar fields; relations filter by row count via $size.
  await querier.findMany(Person, { $where: { id: [1, 2, 3] } });
  await querier.findMany(Person, { $where: { friends: { $size: 2 } } });
  await querier.findMany(Person, { $where: { friends: { $size: { $gte: 2 } } } });
  await querier.findMany(Person, { $where: { friends: { name: 'x' } } });

  // The implicit-IN shorthand is rejected on array-typed fields (ambiguous nesting).
  // @ts-expect-error array-typed fields require an explicit operator
  await querier.findMany(Person, { $where: { embedding: [[1], [2]] } });
  // Note: `{ $size: 2, name: 'x' }` (mixing $size with relation conditions) is not rejected at
  // compile time - union excess-property checking accepts keys from either union arm. The
  // dialect's exact-shape runtime check covers it.

  // Vector search sorts only on number[] fields.
  await querier.findMany(Person, { $sort: { embedding: { $vector: [1, 2, 3] }, name: 'asc' } });
  // @ts-expect-error $vector requires a number[] field
  await querier.findMany(Person, { $sort: { name: { $vector: [1, 2, 3] } } });

  // A to-one relation sorts via a nested map keyed by the related entity's fields, at any depth.
  await querier.findMany(Person, { $sort: { manager: { name: -1 } } });
  await querier.findMany(Person, { $sort: { manager: { manager: { name: -1 } } } });
  // @ts-expect-error 'nope' is not a field of the related entity
  await querier.findMany(Person, { $sort: { manager: { nope: 1 } } });
  // @ts-expect-error a parent has many friends, so there is no single value to order it by
  await querier.findMany(Person, { $sort: { friends: { name: -1 } } });
}
