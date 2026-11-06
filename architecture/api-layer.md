# API layer

**Built**, but for the client typed by the server (open, below). One operation layer every transport shares, REST over HTTP as the one transport uql ships, one client over any transport, and a declared exposure policy.

## The problem

- **Routing and running are one function.** `createRequestHandler` matches a method and a sub-path, then decodes, scopes and runs the operation. tRPC, oRPC, a server action or a NestJS controller needs only the running, and cannot reach it.
- **The client speaks REST alone, and answers differently from the server.** `HttpQuerier` builds URLs itself and resolves to `{ data, count }`, where the pool resolves to the value: code calling both branches on which it holds.
- **Hooks speak HTTP.** They see `method`, and `preSave` and `preFilter` are `pre` split by verb. They mutate the query in place.
- **Exposure is a hook's job.** A `post` hook stripping `passwordHash` from rows still lets `$where: { passwordHash: { $startsWith: 'a' } }` read it a character at a time; `$sort`, `$distinct` and aggregates leak it too. A body setting `role: 'admin'` is refused only by a `preSave` the user remembers to write.
- **A 500 answers the error's message**, a driver's included.

ZenStack v3 has the same handler-plus-adapters shape and enforces its policies in the ORM client. Remult declares exposure on the entity (`includeInApi`, `allowApiUpdate`). oRPC and Hono compose a middleware chain. None of them narrows a client's result by the server's policy without codegen.

## The design

### One call

```ts
type WireCall = {
  entity: string;
  op: ApiOp;
  id?: string | number;
  query?: object;
  payload?: unknown;
  hardDelete?: boolean;
};
```

Plain JSON, so it crosses any transport. `entity` is the entity's path (`entityPath`), `op` a querier method the API serves (`API_OPS`, which says what each does and answers). The flags leave the query: `findManyAndCount` is an op of its own, `hardDelete` a field of the call. `api.call` takes it as `unknown` and checks it with `parseWireCall`, so a transport that checks nothing (a tRPC procedure's input) is safe. A key the op does not take is refused, never ignored, so a client learns its call was not the one run.

`createApi({ pool, include, contextOf, use })` returns `api.call(call, context)`: JSON in, JSON out. It decodes its input by the entity (`parseWireQuery` refuses a clause the wire does not carry or a value of another type, and `readWireQuery` reads values back as the entity holds them), checks it, runs the middleware and the querier, and resolves to the result as JSON carries it (`writeWireData`: a `bigint` as its digits). So a transport needs no serializer of its own, and one that has one (superjson) hands over values the decoding reads as they are.

### Transports

- **HTTP, the protocol uql owns**: `{base}/:entity/:op`, the rest of the call one JSON object. A read is `GET ?q=`, which caches and an `EventSource` can open, or the object as the body of a `QUERY` (RFC 10008) or `POST`, past a URL's length limit; a write is a `POST`. The methods follow `API_OPS[op].access`, so a method an op does not take answers 405 with `Allow`. A body must be `application/json` (415 otherwise), which a cross-site form cannot send. An adapter hands `decodeRequest` the body as text, which it parses only once the method and the content type are taken, so a form's body never reaches a JSON parser; a body a framework parsed already passes as it is. Each refusal is a thrown `UqlRequestError` (404, 405, 415) or `UqlUsageError`, so an adapter answers them as it answers any failure. `http/route.ts` holds `encodeCall(call, readMethod)` and `decodeRequest(req)`, so a round trip is one test, and a client in another language reads the protocol off them. The server wrappers are `toFetchHandler(api)` (the last two path segments, so it mounts on a catch-all under any base), `toExpress(api)` (an unknown entity or op falls through to `next()`, its body unread) and `toRequestHandler(api)` (`undefined` for a route not served). Each asks `api.serves(entityPath, op)` once, then `answerRequest(api, req)`, which answers a served request, a failure included.
- **Any other** is user code over `api.call`: a tRPC or oRPC procedure, a server action, a NestJS controller. They integrate over `api.call`; the HTTP protocol stays uql's own, versioned under its base.

**What changes the result lives in the call; headers carry the request.** `hardDelete`, and later `returning`, are keys of the call; a different result shape is a different op (`count`, `findManyAndCount`). Headers carry `Authorization`, tracing, `Accept: text/event-stream`. So a call is one JSON value, identical over HTTP, tRPC or oRPC, checked by name, and a `GET` caches on its URL alone.

**Errors** answer `{ error: { message, status, kind, path } }`: `kind` is `queryErrorKind`'s, and `path` points at the refused value in the call (`['query', '$where', 'password']`, `['payload', 1, 'email']`), as FastAPI's `loc` does, so a form highlights the field. A querier's refusal names its place within the query (`['$limit']`), and the API answers it under `query`. A driver's message never leaves: an unknown failure is a generic 500.

### One client

`createClientQuerier(transport, { entityPath })`, where a transport is `(call, opts?) => Promise<unknown>`. It answers what the pool answers (rows, counts, ids, `[rows, count]`), reading each row back by the entity. `httpTransport(baseUrl, { headers, readMethod })` is the HTTP one, throwing `RequestError` with the status, kind and path; `(call) => trpc.uql.mutate(call)` is a tRPC one.

A cache keys a read by the call it makes: `createQueryOptions(transport)` records that call without sending it, so `['uql', entityPath, op, rest]` is the key and the read itself the fetch, and the two cannot drift. A read of more than one call has no single key and is refused.

Request notifications are a wrapper around the transport, not a process-wide bus, so a server rendering two requests keeps them apart.

### Middleware

`use: [(call, ctx, next) => next(call)]` replaces `pre`, `preSave`, `preFilter` and `post`. A middleware reshapes the call, aborts by throwing (a `UqlRequestError` answers its status), or reshapes the result it awaits. It runs before the pool resolves, and sees the result as the entity holds it.

- **The call is one member per op** (`ApiCall<E>`), so narrowing on `op` types the payload: a row, a list of rows, or an update's changes. It carries the entity's class, not its metadata, so a call to `User` is a call to `object` and the chain needs no cast.
- **The API's `use` runs on every call, a `serve`'s on its entity's alone**, after the API's, typed by the entity: what reads or writes members (stamping an author, scoping a read) belongs to the entity, what reads none (logging, a refusal) to the API.
- **Context**: with `contextOf`, the call runs inside `withContext` of what it resolved; without it, the call keeps the context its caller runs in, a tRPC middleware's included, so a procedure that set the tenant is not undone.

### Exposure

```ts
include: [
  Post,
  serve(User, { ops: ['read', 'update'], members: { passwordHash: false, role: ['read'], password: ['insert'] } }),
];
```

- **Operations are the querier's words.** An entity takes `('read' | 'insert' | 'update' | 'delete')[]`; a field `('read' | 'insert' | 'update')[]` or `false`, since a delete removes a row, never a field. `insert`, not `create`: the querier says `insertOne`.
- **`read` is everything that reads the value**: select, filter, sort, distinct, an aggregate.
- **A save carries both**: every field it names needs `insert` and `update`. So does a relation a write nests, which the cascade saves whatever the op; an update nesting a to-many also deletes the rows it stops listing, so it needs `delete` on the target.
- **A JSON path reads its member**: `'meta.plan'` in a filter or a sort is checked as `meta`.
- **What is not listed keeps every operation**, as an entity in `include` serves every route.
- **The map is declared over `F extends keyof E`**, so a typo does not compile and a rename follows.

One pure function, `exposedQuery`, gives the query a call runs with. Its walk it refuses a relation out of `include`, an operation the entity does not take, and a field at any depth of the query or the body, with a `UqlSecurityError` naming the path. It reads the client's call, before any middleware, so what a middleware adds is the server's own. A read naming no `$select` leaves the hidden fields out at every depth, a populated relation's included.

Roles that see different fields are two APIs on two paths. A policy resolved per request waits for a case two APIs cannot serve.

### Errors

`toErrorResponse` answers a `UqlError` with its message, status, kind and path, a middleware's or a hook's `UqlRequestError` included. It takes no `status` off any other error, since libSQL's HTTP errors carry one and name tables: it answers a constraint violation with a generic 409 or 400, a retryable failure (a deadlock, a serialization failure) with a 503, and anything else with a 500 saying `Internal Server Error`: a driver's message names tables and echoes values.

## Rejected

- **Answers named after ops** (`findAndCount`). An answer is a shape, `rows`, `page`, `rowsAndCount`, `ids` or `count`: several ops share one, and the conversion switches on the shape.
- **Exposure on the field** (`wireable`, Remult's `includeInApi`). It is a property of the surface, not the data: an admin API and a public one serve the same `User` with different fields, and a flag on the column couples the model to one transport.
- **REST routes per op** (`GET /user`, `PATCH /user/:id`, `DELETE /user/:id`). uql's ops do not map onto verbs (`saveOne` is an upsert, two ops would be `PATCH`), an option would need a header, and a filter on a write would have to fit a URL. One rule, `POST /:entity/:op`, holds every write.
- **Delegating the protocol to tRPC or oRPC.** They integrate through `api.call`; the HTTP contract stays uql's, so it does not change with a framework's version.
- **Options in headers** (a `Prefer` header). A header does not cross tRPC or oRPC, costs a CORS preflight, and needs `Vary` to cache.

## Open

- **A client typed by the server.** `createClientQuerier<typeof api>(transport)`, importing the API's type alone, would make `$select: { passwordHash: true }` a compile error, not a 403. Narrowing reaches every depth a relation does, so each read would map each related entity's type through its exposure, on top of what `QueryFindResult` already costs a read; it waits for a measurement on `bun run ts.perf` that says it stays near today's.

- **Live queries.** A read the client subscribes to, answered again when a write changes it. Re-running each subscription after uql's own writes, under the subscriber's context (Remult's way), misses any other writer and needs a pub/sub across instances; reading each engine's change stream (logical replication, binlog, change streams) sees every writer but SQLite, D1 and libSQL have none. A `GET ?q=` with `Accept: text/event-stream` is the shape the wire leaves room for.
- **Procedures.** Custom logic beside the ops, declared in `serve` per entity or at the top level, a name never shadowing an op.
- **OpenAPI.** A spec generated from `API_OPS`, entity metadata and `serve`.
