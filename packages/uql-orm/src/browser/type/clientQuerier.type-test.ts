/**
 * Type-level regression tests keeping {@link ClientQuerier} in sync with {@link UniversalQuerier}.
 *
 * The two interfaces cannot share a definition (client returns are wrapped in
 * `RequestSuccessResponse` and TypeScript lacks higher-kinded type wrappers), so parity is locked
 * mechanically: two-way key coverage against an explicit reviewed server-only list, plus
 * representative calls passing the same query literals to both interfaces so a parameter-shape
 * drift on any method breaks this file.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `-test.ts` suffix).
 */
import type { Json, UniversalQuerier } from '../../type/index.js';
import type { ClientQuerier } from './clientQuerier.js';

class Author {
  id!: number;
  name!: string;
}

class Article {
  id!: number;
  title!: string;
  tags?: string[];
  kind?: Json<{ public?: number }>;
  author?: Author;
}

type AssertEmpty<T extends never> = T;

/** Server methods intentionally absent from the wire API - reviewed list, extend consciously. */
type ServerOnlyOperation =
  | 'findManyStream'
  | 'aggregate'
  | 'upsertOne'
  | 'upsertMany'
  | 'restoreOneById'
  | 'restoreMany';

/** A server method (other than the reviewed server-only ones) is missing on the client. */
export type MissingOnClient = AssertEmpty<Exclude<keyof UniversalQuerier, ServerOnlyOperation | keyof ClientQuerier>>;

/** The client declares a method the server contract does not have. */
export type ExtraOnClient = AssertEmpty<Exclude<keyof ClientQuerier, keyof UniversalQuerier>>;

declare const server: UniversalQuerier;
declare const client: ClientQuerier;

export async function clientServerParity() {
  // The same query/payload literals must be accepted by both interfaces.
  await server.findOneById(Article, 1, { $select: { title: true } });
  await client.findOneById(Article, 1, { $select: { title: true } });

  await server.findOne(Article, { $where: { title: 'x' }, $populate: { author: true } });
  await client.findOne(Article, { $where: { title: 'x' }, $populate: { author: true } });

  await server.findMany(Article, { $where: { title: { $startsWith: 'a' } }, $sort: { id: -1 }, $limit: 10 });
  await client.findMany(Article, { $where: { title: { $startsWith: 'a' } }, $sort: { id: -1 }, $limit: 10 });

  await server.findManyAndCount(Article, { $skip: 5 });
  await client.findManyAndCount(Article, { $skip: 5 });

  await server.count(Article);
  await client.count(Article);
  await server.count(Article, { $where: { id: 1 } });
  await client.count(Article, { $where: { id: 1 } });

  const serverInsertedId: number | undefined = await server.insertOne(Article, { id: 1, title: 'a' });
  const clientInserted = await client.insertOne(Article, { id: 1, title: 'a' });
  const clientInsertedId: number | undefined = clientInserted.data;
  void serverInsertedId;
  void clientInsertedId;

  await server.insertMany(Article, [{ id: 1, title: 'a' }]);
  await client.insertMany(Article, [{ id: 1, title: 'a' }]);

  await server.updateOneById(Article, 1, { title: 'b' });
  await client.updateOneById(Article, 1, { title: 'b' });

  await server.updateMany(Article, { $where: { id: 1 } }, { title: 'b' });
  await client.updateMany(Article, { $where: { id: 1 } }, { title: 'b' });

  await server.saveOne(Article, { id: 1, title: 'a' });
  await client.saveOne(Article, { id: 1, title: 'a' });

  await server.saveMany(Article, [{ id: 1, title: 'a' }]);
  await client.saveMany(Article, [{ id: 1, title: 'a' }]);

  await server.deleteOneById(Article, 1);
  await client.deleteOneById(Article, 1);

  await server.deleteMany(Article, { $where: { id: [1, 2] } });
  await client.deleteMany(Article, { $where: { id: [1, 2] } });
}
