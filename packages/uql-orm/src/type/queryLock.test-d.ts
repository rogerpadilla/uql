/**
 * Type-level regression tests for `$lock`. Both accepted shapes compile, the wait vocabulary is
 * closed, and the key is absent where a lock could never be honored: `count`/`update`/`delete`
 * (which take `QuerySearch`) and a populated relation.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build. Each `@ts-expect-error` fails the type-check if the error it guards ever stops happening.
 */
import type { ClientQuerier } from '../browser/type/clientQuerier.js';
import type { Querier } from '../index.js';

class Company {
  id!: number;
  name!: string;
}

class Employee {
  id!: number;
  name!: string;
  companyId!: number;
  company!: Company;
  projects!: Project[];
}

class Project {
  id!: number;
  employeeId!: number;
}

export async function lockShapes(querier: Querier) {
  // the boolean and the object form are both accepted
  await querier.findMany(Employee, { $lock: true });
  await querier.findMany(Employee, { $lock: false });
  await querier.findMany(Employee, { $lock: {} });
  await querier.findMany(Employee, { $lock: { wait: 'skip' } });
  await querier.findMany(Employee, { $lock: { wait: 'nowait' } });
  await querier.findMany(Employee, { $lock: { wait: 'block' } });

  // a lock is meaningful on the single-row reads too
  await querier.findOne(Employee, { $where: { id: 1 }, $lock: true });
  await querier.findOneById(Employee, 1, { $lock: true });
}

export async function lockVocabularyIsClosed(querier: Querier) {
  // @ts-expect-error 'soon' is not a wait policy
  await querier.findMany(Employee, { $lock: { wait: 'soon' } });
  // @ts-expect-error the lock has no target list: it always covers the queried entity only
  await querier.findMany(Employee, { $lock: { of: ['company'] } });
  // @ts-expect-error there is one lock strength, so there is no mode to pick
  await querier.findMany(Employee, { $lock: 'update' });
}

export async function lockIsAbsentWhereItCannotBeHonored(querier: Querier) {
  // @ts-expect-error a lock belongs to a SELECT, and count takes QueryPage
  await querier.count(Employee, { $lock: true });
  // @ts-expect-error same for update
  await querier.updateMany(Employee, { $lock: true }, { name: 'x' });
  // @ts-expect-error same for delete
  await querier.deleteMany(Employee, { $lock: true });

  // @ts-expect-error a lock is statement-level, not per populated relation
  await querier.findMany(Employee, { $populate: { projects: { $lock: true } } });
  // @ts-expect-error and a to-one populate never had the key either
  await querier.findMany(Employee, { $populate: { company: { $lock: true } } });
}

/**
 * The browser client takes the same `Query` as the server, `$lock` included, so this compiles. The
 * transport is what rejects it, with a 400: a type-level guard here would only have caught an inline
 * literal, since a pre-built query assigned to a narrowed type passes excess-property checking.
 */
export async function lockOverHttpIsARuntimeConcern(client: ClientQuerier) {
  await client.findMany(Employee, { $lock: true });
}
