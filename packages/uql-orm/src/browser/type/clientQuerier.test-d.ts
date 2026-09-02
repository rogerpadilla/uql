/**
 * Type-level regression tests keeping {@link ClientQuerier} in sync with {@link UniversalQuerier}.
 *
 * Both take their shared operations from one `SharedQuerier` declaration, so those cannot drift.
 * What is still hand-written per side, and so still checked here: the key coverage each way against
 * an explicit reviewed server-only list, and the writes the server declares without options
 * (`insertOne`/`insertMany`/`saveOne`/`saveMany`), passed the same payload literals on both.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests).
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

  // a write payload is `EntityData<E>`, never `E`: typed as `E` the calls below stop compiling,
  // since a plain object owes back every method the class declares
  slug(): string {
    return this.title;
  }
}

type AssertEmpty<T extends never> = T;

/** Server methods intentionally absent from the wire API - reviewed list, extend consciously. */
type ServerOnlyOperation =
  | 'findManyStream'
  | 'aggregate'
  | 'upsertOne'
  | 'upsertMany'
  | 'restoreOneById'
  | 'restoreMany'
  // reads the engine's own statistics, which a browser has no business asking a server to go read
  | 'estimatedCount';

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

  const serverExists: boolean = await server.exists(Article, { $where: { id: 1 } });
  const clientExists: boolean = (await client.exists(Article, { $where: { id: 1 } })).data;
  void serverExists;
  void clientExists;

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
