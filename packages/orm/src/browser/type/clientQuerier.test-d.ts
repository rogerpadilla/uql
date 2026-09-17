import type { CrudOperation } from '../../http/contract.js';
/**
 * Keeps {@link ClientQuerier} in step with {@link UniversalQuerier} where each side is still written by
 * hand: the key coverage against a reviewed server-only list, and the option-less writes. Type-checked
 * by `bun run ts` only.
 */
import { idKey } from '../../type/index.js';
import type { Json, UniversalQuerier, WireQuery } from '../../type/index.js';
import { raw } from '../../util/index.js';
import type { ClientQuerier } from './clientQuerier.js';

class Author {
  id!: number;
  name!: string;
}

/** A composite key, where `WrittenId` and `IdValue` differ - on a single key they read alike. */
class Enrolment {
  [idKey]?: 'studentId' | 'courseId';
  studentId?: number;
  courseId?: string;
  grade?: string;
}

class Article {
  id!: number;
  title!: string;
  tags?: string[];
  kind?: Json<{ public?: number }>;
  addresses?: Json<{ city?: string }[]>;
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

/** Every wire operation in `CRUD_ROUTES` has a client method. */
export type CoversEveryCrudOperation = AssertEmpty<Exclude<CrudOperation, keyof ClientQuerier>>;

declare const server: UniversalQuerier;
declare const client: ClientQuerier;

/**
 * A `raw` fragment renders SQL against a dialect, and a query leaving the browser travels as JSON, which
 * keeps none of it. The server takes each of these; the client refuses them rather than send `{}`.
 */
export async function rawIsServerOnly() {
  await server.findMany(Article, { $select: [raw`LOG10(id)`.as('score')] });
  // @ts-expect-error a raw projection cannot travel
  await client.findMany(Article, { $select: [raw`LOG10(id)`.as('score')] });

  await server.findMany(Article, { $where: { title: raw`lower(title)` } });
  // @ts-expect-error nor a raw comparison
  await client.findMany(Article, { $where: { title: raw`lower(title)` } });

  await server.findMany(Article, { $where: { $exists: raw`SELECT 1` } });
  // @ts-expect-error nor a raw sub-query
  await client.findMany(Article, { $where: { $exists: raw`SELECT 1` } });

  await server.updateMany(Article, { $where: { id: 1 } }, { title: raw`upper(title)` });
  // @ts-expect-error nor a raw value in an update
  await client.updateMany(Article, { $where: { id: 1 } }, { title: raw`upper(title)` });

  // Nested in an operator map, where the fragment is furthest from the method that refuses it.
  await server.findMany(Article, { $where: { title: { $not: raw`lower(title)` } } });
  // @ts-expect-error nor a raw under a per-field `$not`
  await client.findMany(Article, { $where: { title: { $not: raw`lower(title)` } } });

  await server.findMany(Article, { $where: { addresses: { $elemMatch: { city: raw`lower(city)` } } } });
  // @ts-expect-error nor a raw inside `$elemMatch`
  await client.findMany(Article, { $where: { addresses: { $elemMatch: { city: raw`lower(city)` } } } });

  // What an RPC contract declares as its input is the same query, without the `raw` the wire cannot carry.
  const wire: WireQuery<Article> = { $select: { title: true }, $where: { id: 1 } };
  await client.findMany(Article, wire);
  // @ts-expect-error a raw projection is not part of it
  const rawWire: WireQuery<Article> = { $select: [raw`LOG10(id)`] };
  void rawWire;
}

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

/**
 * Every write reports the same shape on both sides. On a composite key, the one place `WrittenId` and
 * `IdValue` differ: a single key reads alike either way.
 */
export async function writesReportOneShapeOnBothSides(server: UniversalQuerier, client: ClientQuerier) {
  type Id = { studentId?: number; courseId?: string } | undefined;
  const row = { studentId: 1, courseId: 'maths', grade: 'A' };

  const serverInserted: Id = await server.insertOne(Enrolment, row);
  const serverInsertedMany: Id[] = await server.insertMany(Enrolment, [row]);
  const serverSaved: Id = await server.saveOne(Enrolment, row);
  const serverSavedMany: Id[] = await server.saveMany(Enrolment, [row]);

  const clientInserted: Id = (await client.insertOne(Enrolment, row)).data;
  const clientInsertedMany: Id[] = (await client.insertMany(Enrolment, [row])).data;
  const clientSaved: Id = (await client.saveOne(Enrolment, row)).data;
  const clientSavedMany: Id[] = (await client.saveMany(Enrolment, [row])).data;

  return [
    serverInserted,
    serverInsertedMany,
    serverSaved,
    serverSavedMany,
    clientInserted,
    clientInsertedMany,
    clientSaved,
    clientSavedMany,
  ];
}
