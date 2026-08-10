/**
 * Type-level regression tests for the dual-API pattern on `Querier`: `findOne`/`findMany`/
 * `findManyStream`/`findManyAndCount`/`count`/`deleteMany` each take either the classic
 * entity-as-argument form or a single entity-as-field (`{ $entity }`) object, useful for a query built
 * elsewhere (RPC/REST) that cannot carry the entity class itself until it lands back in code.
 *
 * `QuerierPool` has no such overload (see `querierPool.test-d.ts` for why): it is typed as a plain
 * `UniversalQuerier`, whose methods take only the entity-as-argument form, so the `{ $entity }` object
 * is rejected by arity, not by a special-cased type.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Querier, QuerierPool } from '../index.js';

class Article {
  id!: number;
  title!: string;
}

class Author {
  id!: number;
  name!: string;
}

declare const querier: Querier;
declare const pool: QuerierPool;

export async function dualApiOnQuerier() {
  // Classic entity-as-argument form.
  await querier.findOne(Article, { $where: { title: 'x' } });
  await querier.findMany(Article, { $where: { title: 'x' } });
  await querier.findManyAndCount(Article, { $where: { title: 'x' } });
  await querier.count(Article, { $where: { title: 'x' } });
  await querier.deleteMany(Article, { $where: { title: 'x' } });
  for await (const _row of querier.findManyStream(Article, {})) break;

  // Entity-as-field form: the criteria are typed against $entity, same as the two-argument form.
  await querier.findOne({ $entity: Article, $where: { title: 'x' } });
  await querier.findMany({ $entity: Article, $where: { title: 'x' } });
  await querier.findManyAndCount({ $entity: Article, $where: { title: 'x' } });
  await querier.count({ $entity: Article, $where: { title: 'x' } });
  await querier.deleteMany({ $entity: Article, $where: { title: 'x' } });
  for await (const _row of querier.findManyStream({ $entity: Article, $where: {} })) break;

  // @ts-expect-error 'titel' is not a field of Article, checked the same way in the $entity form
  await querier.findMany({ $entity: Article, $where: { titel: 'x' } });
  // @ts-expect-error $entity pins the criteria to Article; Author's fields do not apply
  await querier.findMany({ $entity: Article, $where: { name: 'x' } });
  // @ts-expect-error $entity is required in the query-object form
  await querier.findMany({ $where: { title: 'x' } });

  // The $entity form composes with the criteria of the entity it names, not some other one.
  await querier.findMany({ $entity: Author, $where: { name: 'x' } });
}

export async function poolHasNoEntityAsFieldForm() {
  // The pool accepts only the entity-as-argument form (it is typed as UniversalQuerier).
  await pool.findMany(Article, { $where: { title: 'x' } });

  // @ts-expect-error the pool has no single-argument $entity overload; this is an arity mismatch
  await pool.findMany({ $entity: Article, $where: { title: 'x' } });
}
