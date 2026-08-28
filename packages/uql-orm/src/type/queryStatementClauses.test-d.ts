/**
 * Type-level regression tests for which clauses each statement accepts, and for the values a column
 * accepts. Every negative here compiled once and produced a wrong statement at runtime:
 * a pager on `count` emitted `SELECT COUNT(*) ... OFFSET n` (zero rows back, then a crash reading
 * `res[0].count`) and a method was offered as a populatable relation. The positives matter too: a
 * clause wrongly rejected is as much a regression as one wrongly accepted.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build. Each `@ts-expect-error` fails the type-check if the error it guards ever stops happening.
 */
import type { Querier } from '../index.js';

class Team {
  id!: number;
  name!: string;
}

class Member {
  id!: number;
  name!: string;
  score?: number;
  teamId?: number;
  team?: Team;
  embedding?: number[];

  displayName(): string {
    return this.name;
  }
}

export async function countTakesAFilterOnly(querier: Querier) {
  await querier.count(Member, { $where: { name: 'x' } });
  await querier.count(Member);

  // @ts-expect-error a count returns one row; an OFFSET pushes it out of the result set entirely
  await querier.count(Member, { $skip: 1 });
  // @ts-expect-error a LIMIT on a one-row COUNT is a no-op, so asking for one is a mistake
  await querier.count(Member, { $limit: 10 });
  // @ts-expect-error how many rows match is the same in any order
  await querier.count(Member, { $sort: { score: -1 } });
}

export async function writesTakeTheSameOrderingAsReads(querier: Querier) {
  await querier.findMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } } });
  await querier.findMany(Member, { $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } } });

  // A write settles its rows with a SELECT before writing, and that SELECT has the projection list
  // to hold the distance, so ranking the rows a write picks is as valid as ranking a read's.
  await querier.updateMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } }, $limit: 10 }, { name: 'x' });
  await querier.deleteMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } }, $limit: 10 });

  // a plain ordering and page on a write stays legal: both settle their rows before writing.
  await querier.updateMany(Member, { $sort: { score: -1 }, $limit: 1 }, { name: 'x' });
  await querier.deleteMany(Member, { $sort: { score: -1 }, $limit: 1 });
}

export async function methodsAreNotRelations(querier: Querier) {
  await querier.findMany(Member, { $populate: { team: true } });

  // @ts-expect-error `displayName` is a method, not a relation to populate
  await querier.findMany(Member, { $populate: { displayName: true } });
  // @ts-expect-error nor is it a field to select
  await querier.findMany(Member, { $select: { displayName: true } });
}

/**
 * An optional property is a nullable column, so `null` is a value it holds - and clearing one is
 * what an update is for. Both of these needed an `as any` before.
 */
export async function nullIsAValueOfANullableColumn(querier: Querier) {
  await querier.updateMany(Member, { $where: { id: 1 } }, { teamId: null });
  await querier.count(Member, { $where: { teamId: null } });
  await querier.findMany(Member, { $where: { teamId: { $eq: null } } });

  // @ts-expect-error `name` is declared non-optional, so it is a NOT NULL column
  await querier.updateMany(Member, { $where: { id: 1 } }, { name: null });
}
