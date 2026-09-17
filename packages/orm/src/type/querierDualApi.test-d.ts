/**
 * The dual API on `Querier`: each read and `deleteMany` take the entity first or as the query's
 * `$entity`, for a query built where the class is not at hand. A pool takes the first form only, so the
 * other is rejected by arity. Type-checked by `bun run ts` only.
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
  await querier.exists(Article, { $where: { title: 'x' } });
  await querier.deleteMany(Article, { $where: { title: 'x' } });
  for await (const _row of querier.findManyStream(Article, {})) break;

  // Entity-as-field form: the criteria are typed against $entity, same as the two-argument form.
  await querier.findOne({ $entity: Article, $where: { title: 'x' } });
  await querier.findMany({ $entity: Article, $where: { title: 'x' } });
  await querier.findManyAndCount({ $entity: Article, $where: { title: 'x' } });
  await querier.count({ $entity: Article, $where: { title: 'x' } });
  await querier.exists({ $entity: Article, $where: { title: 'x' } });
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
